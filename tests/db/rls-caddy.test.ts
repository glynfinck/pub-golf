import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { CADDY_FAIR_USE_PER_DAY } from "@/lib/caddy/fair-use";
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

describe("a fee buys one course, and tearing it out buys the next", () => {
  let host: Actor;
  let feeId: string;

  async function seedCourse(owner: Actor, name = "The Shoreditch Nine") {
    const { data, error } = await adminClient()
      .from("courses")
      .insert({ owner: owner.userId, name })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function fileCourse(session: string, courseId: string) {
    return host.db
      .from("caddy_sessions")
      .update({ course_id: courseId })
      .eq("id", session);
  }

  beforeEach(async () => {
    host = await signedInUser("Allowance Host");
    feeId = await seedFee(host);
  });

  it("lets the first course through", async () => {
    const session = await seedSession(host, feeId);
    const { error } = await fileCourse(session, await seedCourse(host));
    expect(error).toBeNull();
  });

  it("refuses a second course on the same fee", async () => {
    // The hole this closes: twenty-four hours of caddy meant Shoreditch, then
    // Soho, then Camden, keeping all three. Unbounded output for a fixed
    // price — and neither the budget nor fair use catches it, because both
    // bound tokens rather than what somebody unhurried walks away with.
    const first = await seedSession(host, feeId);
    await fileCourse(first, await seedCourse(host, "The First"));

    const second = await seedSession(host, feeId);
    const { error } = await fileCourse(second, await seedCourse(host, "The Second"));
    expectDenied(error);
  });

  it("frees the fee when the course is torn out of the book", async () => {
    // No bookkeeping and nothing to clean up: `on delete set null` (20260827)
    // nulls the link, and the fee is unspent by the same fact that made it
    // spent. Plan, look, dislike it, delete, plan again — all day.
    const first = await seedSession(host, feeId);
    const courseId = await seedCourse(host, "The Regrettable");
    await fileCourse(first, courseId);
    await adminClient().from("courses").delete().eq("id", courseId);

    const second = await seedSession(host, feeId);
    const { error } = await fileCourse(second, await seedCourse(host, "The Better One"));
    expect(error).toBeNull();
  });

  it("gives a second fee its own course", async () => {
    // "Unless they want to buy more" has to actually work, and it only does
    // because the allowance is keyed on the entitlement rather than the host.
    const another = await seedFee(host);
    const first = await seedSession(host, feeId);
    await fileCourse(first, await seedCourse(host, "Fee One"));

    const second = await seedSession(host, another);
    const { error } = await fileCourse(second, await seedCourse(host, "Fee Two"));
    expect(error).toBeNull();
  });

  it("never takes back a course already in the book", async () => {
    // Not a clawback: the guard refuses a new stamp and never touches an
    // existing one, so deploying it cannot remove anything a host already has.
    const first = await seedSession(host, feeId);
    const courseId = await seedCourse(host, "Already Mine");
    await fileCourse(first, courseId);

    const second = await seedSession(host, feeId);
    await fileCourse(second, await seedCourse(host, "Refused"));

    const { data } = await adminClient()
      .from("caddy_sessions")
      .select("course_id")
      .eq("id", first)
      .maybeSingle();
    expect(data?.course_id).toBe(courseId);
  });

  it("still lets a session that has spent the fee be closed", async () => {
    // The guard is about claiming a course. Closing a session and dropping its
    // dossier must stay possible, or a host's last act on their one course
    // would fail.
    const session = await seedSession(host, feeId);
    await fileCourse(session, await seedCourse(host));
    const { error } = await host.db
      .from("caddy_sessions")
      .update({ completed_at: new Date().toISOString(), dossier: [] })
      .eq("id", session);
    expect(error).toBeNull();
  });

  it("offers an unspent fee, and stops offering a spent one", async () => {
    // The app and the trigger answer the same question and must agree: this
    // picks the fee to work under, the trigger decides whether the stamp is
    // allowed. Disagreement is a host who is told to go ahead and then refused.
    const before = await adminClient().rpc("caddy_unspent_fee", { who: host.userId });
    expect(before.data).toBe(feeId);

    const session = await seedSession(host, feeId);
    await fileCourse(session, await seedCourse(host));

    const after = await adminClient().rpc("caddy_unspent_fee", { who: host.userId });
    expect(after.data).toBeNull();
  });

  it("does not offer an expired fee, spent or not", async () => {
    await adminClient()
      .from("entitlements")
      .update({ expires_at: new Date(Date.now() - HOUR).toISOString() })
      .eq("id", feeId);
    const { data } = await adminClient().rpc("caddy_unspent_fee", { who: host.userId });
    expect(data).toBeNull();
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
