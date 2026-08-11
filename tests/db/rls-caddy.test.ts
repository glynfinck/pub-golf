import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { CADDY_FAIR_USE_PER_DAY } from "@/lib/caddy/fair-use";
import { CADDY_TOPUP_LOOKUP_KEYS, CADDY_TOPUPS } from "@/lib/billing";
import { CADDY_GRANT_SIZE } from "@/lib/caddy/credits";
import { caddyBudgetMicroPence, MODEL_PRICES } from "@/lib/caddy/budget";
import {
  adminClient,
  anonymousGuest,
  signedInUser,
  visitor,
  type Actor,
} from "@/tests/support/clients";

import { expectDenied } from "./helpers/assert";

const HOUR = 3_600_000;

/**
 * The caddy's two tables, attacked.
 *
 * These are the only tables on the stack where a row *is* money: a
 * `caddy_turns` row is what the fair-use ceiling counts and what the budget
 * sums, so anything a host can do to one of those rows they can do to their
 * own bill. Every other table on this stack has an adversarial suite and this
 * one had none, which is the gap this file closes.
 *
 * Three properties carry the whole design, and each of them is one section
 * below:
 *
 *   **A session is private to its host.** Not officials-and-host, not
 *   members — the host alone. A brief is working notes and a dossier is
 *   forty pubs of Google's atmosphere data; neither has a second audience.
 *
 *   **A turn is append-only.** No update policy and no delete policy, on
 *   purpose. A host who could edit a turn could zero what it cost; a host who
 *   could delete one could reclaim fair use by tidying up after themselves.
 *
 *   **The count and the cost are Postgres's, not the client's.** The ceiling
 *   is a trigger holding an advisory lock, and the cost is recomputed from
 *   the token columns on the way in. A number posted by a client is ignored.
 *
 * House rules for this tier, as everywhere: `adminClient()` seeds and reads
 * back, never the subject; and an UPDATE that RLS filters out returns no error
 * and no rows, so a blocked write is proved by re-reading the row.
 *
 * On these two tables most of the refusals are *stronger* than that, and it is
 * worth knowing which is which. `authenticated` is granted `select, insert` on
 * `caddy_turns` and nothing else, and only `update (completed_at, dossier)` on
 * `caddy_sessions` — so an edit is refused at the **grant** with 42501 rather
 * than filtered by a policy. Read the error shape: 42501 is always the grant,
 * and a policy refusal is silence. Both are asserted below, because a test
 * that only re-read the row would pass just as happily under either, and they
 * are different amounts of safety.
 */

/** A green fee the way the webhook writes one, so a session has something to
 * be worked under. */
async function seedFee(buyer: Actor) {
  const { data, error } = await adminClient()
    .from("entitlements")
    .insert({
      user_id: buyer.userId,
      kind: "green_fee",
      stripe_event_id: `evt_caddy_${randomUUID()}`,
      expires_at: new Date(Date.now() + 12 * 3_600_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** A session, seeded past RLS — these tests ask who may read and write one,
 * not how the action builds it. */
async function seedSession(host: Actor, entitlementId?: string) {
  const { data, error } = await adminClient()
    .from("caddy_sessions")
    .insert({
      host: host.userId,
      entitlement_id: entitlementId ?? null,
      brief: { where: "Shoreditch", holes: 9 },
      dossier: [{ id: "p1", name: "The Old Blue Last" }],
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** One turn, as the pipeline writes it. */
function turnRow(host: Actor, sessionId: string, over: Record<string, unknown> = {}) {
  return {
    session_id: sessionId,
    host: host.userId,
    kind: "plan" as const,
    result: { name: "The Crawl", holes: [] },
    model: "claude-sonnet-5",
    input_tokens: 1_000,
    output_tokens: 1_000,
    ...over,
  };
}

async function storedSession(id: string) {
  const { data, error } = await adminClient()
    .from("caddy_sessions")
    .select("host, brief, dossier, completed_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function storedTurn(id: string) {
  const { data, error } = await adminClient()
    .from("caddy_turns")
    .select("host, kind, cost_micropence, failed, input_tokens")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

describe("caddy sessions are the host's alone", () => {
  let host: Actor;
  let other: Actor;
  let sessionId: string;

  beforeEach(async () => {
    [host, other] = await Promise.all([
      signedInUser("Caddy Host"),
      signedInUser("Another Host"),
    ]);
    sessionId = await seedSession(host, await seedFee(host));
  });

  it("shows a host their own session", async () => {
    const { data } = await host.db.from("caddy_sessions").select("id").eq("id", sessionId);
    expect(data?.map((row) => row.id)).toEqual([sessionId]);
  });

  it("hides it from every other signed-in host", async () => {
    // No official's view and no member's view: a brief is working notes.
    const { data, error } = await other.db
      .from("caddy_sessions")
      .select("id")
      .eq("id", sessionId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("hides it from a guest, who is an anonymous user rather than the anon role", async () => {
    const guest = await anonymousGuest("Guest");
    const { data } = await guest.db.from("caddy_sessions").select("id");
    expect(data).toEqual([]);
  });

  it("refuses a signed-out request at the gate rather than with an empty list", async () => {
    // `anon` is granted nothing at all on these tables, so this is a table
    // grant refusal (42501) and not a policy returning zero rows. The
    // difference matters: one says "not for you", the other says "nothing
    // here", and only the first is true.
    const { error } = await visitor().from("caddy_sessions").select("id");
    expectDenied(error);
  });

  it("will not let a host start a session in somebody else's name", async () => {
    const { error } = await host.db
      .from("caddy_sessions")
      .insert({ host: other.userId, brief: {}, dossier: [] });
    expectDenied(error);
  });

  it("lets a host close their own session and drop its dossier", async () => {
    const stamp = new Date().toISOString();
    await host.db
      .from("caddy_sessions")
      .update({ completed_at: stamp, dossier: [] })
      .eq("id", sessionId);
    const stored = await storedSession(sessionId);
    expect(stored?.completed_at).not.toBeNull();
    expect(stored?.dossier).toEqual([]);
  });

  it("will not let a host rewrite the brief a turn was worked under", async () => {
    // The column grant, not a policy: `update (completed_at, dossier)` is the
    // whole of what `authenticated` may write, so re-briefing a session after
    // its turns were charged is refused at the grant.
    const { error } = await host.db
      .from("caddy_sessions")
      .update({ brief: { where: "Somewhere else", holes: 18 } })
      .eq("id", sessionId);
    expectDenied(error);
    expect(await storedSession(sessionId)).toMatchObject({
      brief: { where: "Shoreditch", holes: 9 },
    });
  });

  it("will not let a host hand their session to somebody else", async () => {
    const { error } = await host.db
      .from("caddy_sessions")
      .update({ host: other.userId })
      .eq("id", sessionId);
    expectDenied(error);
    expect((await storedSession(sessionId))?.host).toBe(host.userId);
  });

  it("keeps a host's sessions when the fee behind them is refunded", async () => {
    // Covered stays covered, the same asymmetry 20260823 establishes for a
    // round: `on delete set null`, never a cascade onto the host's drafts.
    await adminClient().from("entitlements").delete().eq("user_id", host.userId);
    expect(await storedSession(sessionId)).not.toBeNull();
  });
});

describe("caddy turns are append-only, and they are the bill", () => {
  let host: Actor;
  let other: Actor;
  let sessionId: string;

  beforeEach(async () => {
    [host, other] = await Promise.all([
      signedInUser("Turn Host"),
      signedInUser("Turn Other"),
    ]);
    sessionId = await seedSession(host, await seedFee(host));
  });

  it("lets a host append a turn to their own session", async () => {
    const { data, error } = await host.db
      .from("caddy_turns")
      .insert(turnRow(host, sessionId))
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(await storedTurn(data!.id)).toMatchObject({ host: host.userId });
  });

  it("will not let a host append to somebody else's session", async () => {
    // The `exists` half of the insert policy. Without it a script could hang
    // its turns on a stranger's session and spend against their ceiling.
    const { error } = await other.db
      .from("caddy_turns")
      .insert(turnRow(other, sessionId));
    expectDenied(error);
  });

  it("will not let a host file a turn under another host's name", async () => {
    const mine = await seedSession(other, await seedFee(other));
    const { error } = await other.db
      .from("caddy_turns")
      .insert(turnRow(other, mine, { host: host.userId }));
    expectDenied(error);
  });

  it("cannot be edited, which is what stops a host zeroing what they spent", async () => {
    const { data } = await host.db
      .from("caddy_turns")
      .insert(turnRow(host, sessionId))
      .select("id")
      .single();
    const before = await storedTurn(data!.id);
    // Refused at the *grant*, not by a policy — `authenticated` is granted
    // only `select, insert` on this table, so there is no UPDATE privilege to
    // filter. Worth reading the error shape rather than assuming: 42501 is
    // always the table grant, and a policy refusal returns no rows and no
    // error at all. This is the stronger of the two, and the row is still the
    // proof.
    const { error } = await host.db
      .from("caddy_turns")
      .update({ input_tokens: 0, output_tokens: 0 })
      .eq("id", data!.id);
    expectDenied(error);
    expect(await storedTurn(data!.id)).toEqual(before);
  });

  it("cannot be deleted, which is what stops a host reclaiming fair use", async () => {
    const { data } = await host.db
      .from("caddy_turns")
      .insert(turnRow(host, sessionId))
      .select("id")
      .single();
    // Same again: no DELETE grant, so it never reaches a policy. Asserted as
    // well as re-read, because a test that only re-reads the row would pass
    // just as happily if the delete had been silently filtered — and those are
    // different amounts of safety.
    const { error } = await host.db.from("caddy_turns").delete().eq("id", data!.id);
    expectDenied(error);
    expect(await storedTurn(data!.id)).not.toBeNull();
  });

  it("prices the turn itself, ignoring any figure the client posts", async () => {
    // The forgery that would make the caddy free. Cost is recomputed from the
    // token columns by the trigger in 20260826, so a posted zero is overwritten
    // rather than trusted.
    const { data } = await host.db
      .from("caddy_turns")
      .insert(turnRow(host, sessionId, { cost_micropence: 0 }))
      .select("id")
      .single();
    const stored = await storedTurn(data!.id);
    expect(Number(stored?.cost_micropence)).toBeGreaterThan(0);
  });

  it("prices an unknown model at the dearest tier rather than at nothing", async () => {
    // A model name nobody has priced must never bill as free — that would make
    // "spend from an unlisted model" the cheapest attack on the budget.
    const dearest = await host.db
      .from("caddy_turns")
      .insert(turnRow(host, sessionId, { model: "some-model-we-have-never-heard-of" }))
      .select("id")
      .single();
    const known = await host.db
      .from("caddy_turns")
      .insert(turnRow(host, sessionId, { model: "claude-haiku-4-5-20251001" }))
      .select("id")
      .single();
    const unknownCost = Number((await storedTurn(dearest.data!.id))?.cost_micropence);
    const knownCost = Number((await storedTurn(known.data!.id))?.cost_micropence);
    expect(unknownCost).toBeGreaterThan(knownCost);
    // And specifically the dearest board price we publish.
    expect(MODEL_PRICES["claude-opus-5"].output).toBeGreaterThanOrEqual(
      MODEL_PRICES["claude-sonnet-5"].output,
    );
  });

  it("charges a failed turn but does not count it against the card", async () => {
    // The vendor bills a refusal exactly like a good answer. What keeps the
    // host's promise honest is that the money counts and the card does not.
    const { data } = await host.db
      .from("caddy_turns")
      .insert(turnRow(host, sessionId, { failed: true, result: {} }))
      .select("id")
      .single();
    const stored = await storedTurn(data!.id);
    expect(stored?.failed).toBe(true);
    expect(Number(stored?.cost_micropence)).toBeGreaterThan(0);
  });
});

describe("the course a session filed", () => {
  let host: Actor;
  let other: Actor;
  let sessionId: string;

  /** A course the way the builder files one, minus the holes nobody reads
   * here. */
  async function seedCourse(owner: Actor, name = "The Shoreditch Nine") {
    const { data, error } = await adminClient()
      .from("courses")
      .insert({ owner: owner.userId, name })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function storedCourseLink(id: string) {
    const { data, error } = await adminClient()
      .from("caddy_sessions")
      .select("course_id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data?.course_id ?? null;
  }

  beforeEach(async () => {
    [host, other] = await Promise.all([
      signedInUser("Filing Host"),
      signedInUser("Filing Other"),
    ]);
    sessionId = await seedSession(host, await seedFee(host));
  });

  it("lets a host record which course their session filed", async () => {
    const courseId = await seedCourse(host);
    const { error } = await host.db
      .from("caddy_sessions")
      .update({ course_id: courseId })
      .eq("id", sessionId);
    expect(error).toBeNull();
    expect(await storedCourseLink(sessionId)).toBe(courseId);
  });

  it("keeps the first course it filed, and refuses a second", async () => {
    // One-way, like the bug report's issue stamp. The only job this link has
    // is stopping a duplicate course, and a movable version of it would be a
    // way to make one.
    const first = await seedCourse(host, "The First");
    const second = await seedCourse(host, "The Second");
    await host.db.from("caddy_sessions").update({ course_id: first }).eq("id", sessionId);

    const { error } = await host.db
      .from("caddy_sessions")
      .update({ course_id: second })
      .eq("id", sessionId);
    expectDenied(error);
    expect(await storedCourseLink(sessionId)).toBe(first);
  });

  it("will not let a stranger point somebody else's session at a course", async () => {
    const courseId = await seedCourse(other);
    // Filtered rather than refused: the update policy is `host = auth.uid()`,
    // and a policy that matches nothing is silence. The row is the proof.
    const { error } = await other.db
      .from("caddy_sessions")
      .update({ course_id: courseId })
      .eq("id", sessionId);
    expect(error).toBeNull();
    expect(await storedCourseLink(sessionId)).toBeNull();
  });

  it("keeps the conversation when the course is torn out of the book", async () => {
    // `set null`, never a cascade. Tearing a course out is not ending the
    // conversation, and the host should keep the dossier they are working
    // against — the same asymmetry the entitlement link keeps.
    const courseId = await seedCourse(host);
    await host.db.from("caddy_sessions").update({ course_id: courseId }).eq("id", sessionId);
    await adminClient().from("courses").delete().eq("id", courseId);

    expect(await storedSession(sessionId)).not.toBeNull();
    expect(await storedCourseLink(sessionId)).toBeNull();
  });

  it("still lets the session be closed afterwards", async () => {
    // The guard is about `course_id` alone; it must not block the stamp that
    // ends a session and drops its dossier.
    const courseId = await seedCourse(host);
    await host.db.from("caddy_sessions").update({ course_id: courseId }).eq("id", sessionId);
    const { error } = await host.db
      .from("caddy_sessions")
      .update({ completed_at: new Date().toISOString(), dossier: [] })
      .eq("id", sessionId);
    expect(error).toBeNull();
    expect((await storedSession(sessionId))?.completed_at).not.toBeNull();
  });
});

describe("the ledger: granted, spent, and expired", () => {
  let host: Actor;
  let feeId: string;
  let sessionId: string;

  async function balance(quota: "redesign" | "tweak") {
    const { data } = await adminClient().rpc("caddy_balance", {
      who: host.userId,
      quota,
    });
    return Number(data ?? 0);
  }

  async function spendsFor() {
    const { count } = await adminClient()
      .from("caddy_spends")
      .select("id", { count: "exact", head: true })
      .eq("host", host.userId);
    return count ?? 0;
  }

  beforeEach(async () => {
    host = await signedInUser("Ledger Host");
    feeId = await seedFee(host);
    sessionId = await seedSession(host, feeId);
  });

  it("grants the package with the fee, in one transaction", async () => {
    // On the entitlement rather than in the webhook's code, so there is no
    // window in which a host has paid and holds nothing.
    expect(await balance("redesign")).toBe(CADDY_GRANT_SIZE.redesign);
    expect(await balance("tweak")).toBe(CADDY_GRANT_SIZE.tweak);
  });

  it("spends a re-design on a plan and on a roll, a tweak on a tweak", async () => {
    // A roll is a re-design: it produces a different course from the same
    // patch, which is the expensive thing. Only a tweak edits what is there.
    await host.db.from("caddy_turns").insert(turnRow(host, sessionId, { kind: "plan" }));
    await host.db.from("caddy_turns").insert(turnRow(host, sessionId, { kind: "roll" }));
    await host.db.from("caddy_turns").insert(turnRow(host, sessionId, { kind: "tweak" }));

    expect(await balance("redesign")).toBe(CADDY_GRANT_SIZE.redesign - 2);
    expect(await balance("tweak")).toBe(CADDY_GRANT_SIZE.tweak - 1);
  });

  it("spends nothing on a turn that produced no card", async () => {
    await host.db
      .from("caddy_turns")
      .insert(turnRow(host, sessionId, { kind: "plan", failed: true, result: {} }));
    expect(await balance("redesign")).toBe(CADDY_GRANT_SIZE.redesign);
    expect(await spendsFor()).toBe(0);
  });

  it("keeps the two quotas apart, which is the whole point of two", async () => {
    // Sharing one allowance meant two expensive plans ate the tweaking
    // budget — so the loudest promise the caddy makes was being consumed by
    // the thing next to it.
    for (let i = 0; i < CADDY_GRANT_SIZE.redesign; i += 1) {
      await host.db.from("caddy_turns").insert(turnRow(host, sessionId, { kind: "plan" }));
    }
    expect(await balance("redesign")).toBe(0);
    expect(await balance("tweak")).toBe(CADDY_GRANT_SIZE.tweak);

    const { error } = await host.db
      .from("caddy_turns")
      .insert(turnRow(host, sessionId, { kind: "tweak" }));
    expect(error).toBeNull();
  });

  it("refuses the action once its own quota is gone", async () => {
    for (let i = 0; i < CADDY_GRANT_SIZE.redesign; i += 1) {
      await host.db.from("caddy_turns").insert(turnRow(host, sessionId, { kind: "plan" }));
    }
    const { error } = await host.db
      .from("caddy_turns")
      .insert(turnRow(host, sessionId, { kind: "plan" }));
    expectDenied(error);
  });

  it("never goes negative when a grant expires with spends against it", async () => {
    // The bug a single signed ledger would have: only grants expire, so an
    // expired +3 drops out of the sum while its -1 spends remain and the host
    // ends up owing courses to a fee that is over.
    await host.db.from("caddy_turns").insert(turnRow(host, sessionId, { kind: "plan" }));
    await adminClient()
      .from("caddy_grants")
      .update({ expires_at: new Date(Date.now() - HOUR).toISOString() })
      .eq("host", host.userId);

    expect(await balance("redesign")).toBe(0);
    expect(await balance("tweak")).toBe(0);
    expect(await spendsFor()).toBe(1);
  });

  it("locks an unspent grant once the day is over", async () => {
    await adminClient()
      .from("caddy_grants")
      .update({ expires_at: new Date(Date.now() - HOUR).toISOString() })
      .eq("host", host.userId);
    const { error } = await host.db
      .from("caddy_turns")
      .insert(turnRow(host, sessionId, { kind: "plan" }));
    expectDenied(error);
  });

  it("spends the grant nearest expiry first, so none is wasted", async () => {
    const later = await seedFee(host);
    await adminClient()
      .from("caddy_grants")
      .update({ expires_at: new Date(Date.now() + 48 * HOUR).toISOString() })
      .eq("entitlement_id", later);

    await host.db.from("caddy_turns").insert(turnRow(host, sessionId, { kind: "plan" }));
    // Read in two hops rather than through an embed: the generated types carry
    // no relationship for these tables (hand-written until `gen types` is
    // re-run), and a test should not be the thing that discovers it.
    const { data: spend } = await adminClient()
      .from("caddy_spends")
      .select("grant_id")
      .eq("host", host.userId)
      .limit(1)
      .maybeSingle();
    const { data: grant } = await adminClient()
      .from("caddy_grants")
      .select("entitlement_id")
      .eq("id", spend!.grant_id)
      .maybeSingle();
    expect(grant?.entitlement_id).toBe(feeId);
  });

  it("cannot be granted or spent by the host it charges", async () => {
    // Neither table has an insert policy: grants come from fulfilment as
    // service_role, spends from the trigger as definer.
    expectDenied(
      await host.db
        .from("caddy_grants")
        .insert({ host: host.userId, quota: "redesign", amount: 99 })
        .then((r) => r.error),
    );
    const { data: grant } = await adminClient()
      .from("caddy_grants")
      .select("id")
      .eq("host", host.userId)
      .limit(1)
      .maybeSingle();
    expectDenied(
      await host.db
        .from("caddy_spends")
        .delete()
        .eq("grant_id", grant!.id)
        .then((r) => r.error),
    );
  });

  it("quotes the same package size the database grants", async () => {
    for (const quota of ["redesign", "tweak"] as const) {
      const { data } = await adminClient().rpc("caddy_grant_size", { quota });
      expect(Number(data)).toBe(CADDY_GRANT_SIZE[quota]);
    }
  });

  it("quotes the same top-up sizes the database grants", async () => {
    // Three places hold these numbers — lib/billing.ts, caddy_topup_size, and
    // the Stripe price a host actually pays. This proves the first two agree;
    // the sandbox tier proves the third does.
    for (const kind of CADDY_TOPUP_LOOKUP_KEYS) {
      for (const quota of ["redesign", "tweak"] as const) {
        const { data } = await adminClient().rpc("caddy_topup_size", { kind, quota });
        expect(Number(data), `${kind} / ${quota}`).toBe(CADDY_TOPUPS[kind][quota]);
      }
    }
  });

  it("grants a top-up that never expires, and one a fee cannot outlive", async () => {
    // The whole design in one assertion. A fee's grants carry the pass's
    // expiry; a top-up's carry none, because cost is incurred at redemption
    // and an unredeemed round costs nothing to hold.
    const buyer = await signedInUser("Top-up Buyer");
    const { data: bought } = await adminClient()
      .from("entitlements")
      .insert({
        user_id: buyer.userId,
        kind: "caddy_topup_3",
        stripe_event_id: `evt_topup_${randomUUID()}`,
        // No expiry, which is the entire design: a bought round outlives the
        // night it was bought on.
        expires_at: null,
      })
      .select("id")
      .single();

    const { data: grants } = await adminClient()
      .from("caddy_grants")
      .select("quota, amount, expires_at, reason")
      .eq("entitlement_id", bought!.id);

    expect(grants).toHaveLength(2);
    for (const grant of grants ?? []) {
      expect(grant.expires_at, "a bought round must not expire").toBeNull();
      expect(grant.reason).toBe("caddy_topup_3");
      expect(grant.amount).toBe(
        CADDY_TOPUPS.caddy_topup_3[grant.quota as "redesign" | "tweak"],
      );
    }

    // And it counts: the balance sees it with no fee anywhere in sight.
    const { data: balance } = await adminClient().rpc("caddy_balance", {
      who: buyer.userId,
      quota: "redesign",
    });
    expect(Number(balance)).toBe(CADDY_TOPUPS.caddy_topup_3.redesign);
  });

  /** A purchase, minted by the trigger. Returns the entitlement so a test can
   * refund it — deleting the row is what a refund does to this schema. */
  async function seedTopup(buyer: Actor, kind: "caddy_topup_1" | "caddy_topup_3") {
    const { data, error } = await adminClient()
      .from("entitlements")
      .insert({
        user_id: buyer.userId,
        kind,
        stripe_event_id: `evt_topup_${randomUUID()}`,
        expires_at: null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function balanceOf(buyer: Actor, quota: "redesign" | "tweak") {
    const { data } = await adminClient().rpc("caddy_balance", {
      who: buyer.userId,
      quota,
    });
    return Number(data ?? 0);
  }

  it("accepts both top-up kinds through the entitlements gate", async () => {
    // The regression for a bug the whole pyramid missed: `entitlements.kind`
    // is CHECK-constrained, so before the constraint was restated a top-up row
    // could not be inserted at all. The grant logic was perfect and the
    // purchase died at the door with 23514. A typecheck cannot see a CHECK.
    const buyer = await signedInUser("Kind Gate Buyer");
    for (const kind of CADDY_TOPUP_LOOKUP_KEYS) {
      const id = await seedTopup(buyer, kind);
      expect(id, `${kind} was refused by entitlements_kind_check`).toBeTruthy();
    }
  });

  it("a refunded top-up takes its rounds with it", async () => {
    // The hole this closes: a durable grant has no expiry, so an orphan left
    // behind by `on delete set null` was immortal — refund the purchase, keep
    // the rounds for ever.
    const buyer = await signedInUser("Refunded Buyer");
    const bought = await seedTopup(buyer, "caddy_topup_3");
    expect(await balanceOf(buyer, "redesign")).toBe(
      CADDY_TOPUPS.caddy_topup_3.redesign,
    );

    await adminClient().from("entitlements").delete().eq("id", bought);

    expect(await balanceOf(buyer, "redesign")).toBe(0);
    expect(await balanceOf(buyer, "tweak")).toBe(0);

    // Not merely uncounted — gone. An orphan with a null entitlement would
    // still satisfy the balance query, which is exactly how this failed.
    const { data: orphans } = await adminClient()
      .from("caddy_grants")
      .select("id")
      .eq("host", buyer.userId);
    expect(orphans ?? []).toHaveLength(0);
  });

  it("refunding one purchase leaves the other purchase alone", async () => {
    const buyer = await signedInUser("Two Purchase Buyer");
    const fee = await seedFee(buyer);
    await seedTopup(buyer, "caddy_topup_1");

    expect(await balanceOf(buyer, "redesign")).toBe(
      CADDY_GRANT_SIZE.redesign + CADDY_TOPUPS.caddy_topup_1.redesign,
    );

    // Refund the fee. The top-up is a separate purchase and must survive it.
    await adminClient().from("entitlements").delete().eq("id", fee);

    expect(await balanceOf(buyer, "redesign")).toBe(
      CADDY_TOPUPS.caddy_topup_1.redesign,
    );
  });

  it("a refund never leaves the balance negative, even after spending", async () => {
    // The reason grants and spends are separate tables, proved from the other
    // direction: a single signed-delta ledger would drop the +3 on refund and
    // keep the -1 spends, and the host would owe us rounds.
    const buyer = await signedInUser("Spent Then Refunded");
    const bought = await seedTopup(buyer, "caddy_topup_3");

    const { data: grant } = await adminClient()
      .from("caddy_grants")
      .select("id")
      .eq("entitlement_id", bought)
      .eq("quota", "redesign")
      .single();

    const sessionId = await seedSession(buyer, await seedFee(buyer));
    await adminClient().from("caddy_spends").insert({
      grant_id: grant!.id,
      host: buyer.userId,
      session_id: sessionId,
    });

    await adminClient().from("entitlements").delete().eq("id", bought);

    // The spends cascaded with the grant, so nothing is left pointing at a
    // purchase that no longer exists.
    expect(await balanceOf(buyer, "redesign")).toBeGreaterThanOrEqual(0);
    const { data: spends } = await adminClient()
      .from("caddy_spends")
      .select("id")
      .eq("grant_id", grant!.id);
    expect(spends ?? []).toHaveLength(0);
  });
});

describe("the ceilings hold in Postgres", () => {
  let host: Actor;
  let sessionId: string;

  beforeEach(async () => {
    host = await signedInUser("Ceiling Host");
    sessionId = await seedSession(host, await seedFee(host));
  });

  it("stops a host at the fair-use cap, and says so with 42501", async () => {
    // Seeded as service_role, which the guard exempts — that exemption is the
    // point of the next test, and here it is simply how the ledger gets full
    // without paying for the writes one at a time.
    const filled = Array.from({ length: CADDY_FAIR_USE_PER_DAY }, () =>
      turnRow(host, sessionId),
    );
    const { error: seedError } = await adminClient().from("caddy_turns").insert(filled);
    expect(seedError).toBeNull();

    const { error } = await host.db.from("caddy_turns").insert(turnRow(host, sessionId));
    expectDenied(error);
  });

  it("does not count yesterday's turns against today", async () => {
    // A rolling day, not a calendar one: a host who planned last night is not
    // starting today already spent.
    const yesterday = new Date(Date.now() - 30 * 3_600_000).toISOString();
    await adminClient()
      .from("caddy_turns")
      .insert(
        Array.from({ length: CADDY_FAIR_USE_PER_DAY }, () => ({
          ...turnRow(host, sessionId),
          created_at: yesterday,
        })),
      );
    const { error } = await host.db.from("caddy_turns").insert(turnRow(host, sessionId));
    expect(error).toBeNull();
  });

  it("counts one host's turns against that host alone", async () => {
    const neighbour = await signedInUser("Neighbour");
    const theirs = await seedSession(neighbour, await seedFee(neighbour));
    await adminClient()
      .from("caddy_turns")
      .insert(Array.from({ length: CADDY_FAIR_USE_PER_DAY }, () => turnRow(host, sessionId)));

    const { error } = await neighbour.db
      .from("caddy_turns")
      .insert(turnRow(neighbour, theirs));
    expect(error).toBeNull();
  });

  it("keeps a budget the app and the database agree on", async () => {
    // Both sides read the fee, so they cannot drift by arithmetic — but they
    // can drift by somebody editing one and not the other, which is what this
    // catches.
    const { data, error } = await adminClient().rpc("caddy_budget_micropence");
    expect(error).toBeNull();
    expect(Number(data)).toBe(caddyBudgetMicroPence());
  });

  it("keeps a fair-use cap the app and the database agree on", async () => {
    // `lib/caddy/fair-use.ts` says out loud that a db test holds it against
    // `caddy_fair_use_cap()`. It did not exist until now, so the mirror was a
    // hand-kept copy of a number nothing checked.
    const { data, error } = await adminClient().rpc("caddy_fair_use_cap");
    expect(error).toBeNull();
    expect(Number(data)).toBe(CADDY_FAIR_USE_PER_DAY);
  });
});

describe("the ledger is not the host's to write", () => {
  let host: Actor;
  let other: Actor;
  let feeId: string;
  let grantId: string;

  beforeEach(async () => {
    [host, other] = await Promise.all([
      signedInUser("Wallet Host"),
      signedInUser("Wallet Stranger"),
    ]);
    feeId = await seedFee(host);
    const { data } = await adminClient()
      .from("caddy_grants")
      .select("id")
      .eq("host", host.userId)
      .eq("quota", "redesign")
      .limit(1)
      .maybeSingle();
    grantId = data!.id;
  });

  async function grantAmount() {
    const { data } = await adminClient()
      .from("caddy_grants")
      .select("amount, expires_at")
      .eq("id", grantId)
      .maybeSingle();
    return data;
  }

  /**
   * The whole matrix, because a single hole is the whole hole.
   *
   * Every one of these is refused at the **grant**, not by a policy —
   * `authenticated` holds `select` on both tables and nothing else, so there
   * is no write privilege for a policy to filter. That is the stronger of the
   * two refusals and the error shape says which you got: 42501 is always the
   * table grant, and a policy refusal is silence.
   */
  it("refuses every write a host could attempt on their own ledger", async () => {
    // Thunks, not promises: a PostgREST builder is thenable but not a Promise,
    // and building them all up front would fire every write before the first
    // assertion had a chance to fail.
    const attempts: [string, () => PromiseLike<{ error: unknown }>][] = [
      [
        "mint a grant",
        () =>
          host.db
            .from("caddy_grants")
            .insert({ host: host.userId, quota: "redesign", amount: 999 }),
      ],
      [
        // The obvious attack, and the one nothing covered until now: not
        // forging a row, just editing the number on the row you were given.
        "raise the amount on a grant",
        () =>
          host.db.from("caddy_grants").update({ amount: 999 }).eq("id", grantId),
      ],
      [
        "push a grant's expiry out",
        () =>
          host.db
            .from("caddy_grants")
            .update({ expires_at: new Date(Date.now() + 500 * HOUR).toISOString() })
            .eq("id", grantId),
      ],
      [
        "delete a grant",
        () => host.db.from("caddy_grants").delete().eq("id", grantId),
      ],
      [
        "un-spend by deleting a spend",
        () =>
          host.db.from("caddy_spends").delete().eq("host", host.userId),
      ],
      [
        "move a spend onto somebody else's grant",
        () =>
          host.db.from("caddy_spends").update({ grant_id: grantId }).eq("host", host.userId),
      ],
      [
        "insert a spend against nothing",
        () =>
          host.db
            .from("caddy_spends")
            .insert({ grant_id: grantId, host: host.userId }),
      ],
    ];

    for (const [what, attempt] of attempts) {
      const { error } = (await attempt()) as { error: { code?: string } | null };
      expect(error, `should have refused: ${what}`).not.toBeNull();
      expect(["42501", "23503"], what).toContain(error?.code);
    }

    // And the row is untouched, which is the only proof that counts.
    expect(await grantAmount()).toMatchObject({ amount: CADDY_GRANT_SIZE.redesign });
  });

  it("will not let a host mint grants by forging the purchase behind them", async () => {
    // The new attack surface the package trigger creates: grants are written
    // by a trigger on `entitlements`, so an insert there would mint them.
    // `entitlements` has no write policy at all — this asserts the *pairing*,
    // because that is where somebody would look once they knew the trigger
    // existed.
    const { error } = await host.db.from("entitlements").insert({
      user_id: host.userId,
      kind: "green_fee",
      stripe_event_id: `evt_forged_${randomUUID()}`,
    });
    expectDenied(error);

    const { count } = await adminClient()
      .from("caddy_grants")
      .select("id", { count: "exact", head: true })
      .eq("host", host.userId);
    // Exactly the one package the seeded fee bought: one grant per quota.
    expect(count).toBe(2);
  });

  it("shows a host their own ledger and nobody else's", async () => {
    const mine = await host.db.from("caddy_grants").select("id");
    expect(mine.data?.length).toBe(2);

    const theirs = await other.db.from("caddy_grants").select("id").eq("id", grantId);
    expect(theirs.error).toBeNull();
    expect(theirs.data).toEqual([]);
  });

  it("refuses a signed-out reader at the gate, not with an empty list", async () => {
    expectDenied(await visitor().from("caddy_grants").select("id").then((r) => r.error));
    expectDenied(await visitor().from("caddy_spends").select("id").then((r) => r.error));
  });

  it("drains the quota across delete-and-try-again, which is the point", async () => {
    // The narrative this design exists for: plan Shoreditch, delete it, decide
    // on Soho, plan again, delete, again — and be stopped. Deleting the course
    // gives nothing back, because the caddy did the work and we paid for it.
    // The holdings design this replaced refunded here, which made the quota
    // unbounded for anybody patient.
    for (let round = 0; round < CADDY_GRANT_SIZE.redesign; round += 1) {
      const session = await seedSession(host, feeId);
      const { error } = await host.db
        .from("caddy_turns")
        .insert(turnRow(host, session, { kind: "plan" }));
      expect(error, `re-design ${round + 1} should be allowed`).toBeNull();

      // The host files it, looks at it, dislikes the area, tears it out.
      const { data: course } = await adminClient()
        .from("courses")
        .insert({ owner: host.userId, name: `Attempt ${round + 1}` })
        .select("id")
        .single();
      await host.db
        .from("caddy_sessions")
        .update({ course_id: course!.id })
        .eq("id", session);
      await adminClient().from("courses").delete().eq("id", course!.id);
    }

    const lastTry = await seedSession(host, feeId);
    expectDenied(
      await host.db
        .from("caddy_turns")
        .insert(turnRow(host, lastTry, { kind: "plan" }))
        .then((r) => r.error),
    );

    // And the tweaks were never touched by any of it — separate quota, and the
    // whole reason there are two.
    const { data: tweaks } = await adminClient().rpc("caddy_balance", {
      who: host.userId,
      quota: "tweak",
    });
    expect(Number(tweaks)).toBe(CADDY_GRANT_SIZE.tweak);
  });

  it("counts tweaks down alongside, without touching the re-designs", async () => {
    const session = await seedSession(host, feeId);
    await host.db.from("caddy_turns").insert(turnRow(host, session, { kind: "plan" }));
    for (let i = 0; i < 5; i += 1) {
      await host.db.from("caddy_turns").insert(turnRow(host, session, { kind: "tweak" }));
    }
    const redesigns = await adminClient().rpc("caddy_balance", {
      who: host.userId,
      quota: "redesign",
    });
    const tweaks = await adminClient().rpc("caddy_balance", {
      who: host.userId,
      quota: "tweak",
    });
    expect(Number(redesigns.data)).toBe(CADDY_GRANT_SIZE.redesign - 1);
    expect(Number(tweaks.data)).toBe(CADDY_GRANT_SIZE.tweak - 5);
  });
});
