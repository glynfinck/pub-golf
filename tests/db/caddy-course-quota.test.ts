import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { CADDY_GRANT_SIZE, CADDY_QUOTAS } from "@/lib/caddy/credits";
import {
  CADDY_TOPUP_LOOKUP_KEYS,
  CADDY_TOPUPS,
  DAY_PASS_HOURS,
  type CaddyTopupKey,
} from "@/lib/billing";
import { adminClient, signedInUser, type Actor } from "@/tests/support/clients";

import { expectDenied } from "./helpers/assert";

/**
 * What a green fee buys, and what a host is allowed to keep.
 *
 * The rule: **one caddy course, four revisions of it, sixty tweaks — and the
 * host keeps one course.** Every clause of that was, until `20260905000000`
 * and `20260906000000`, either unwritten or wrong.
 *
 *   The first plan spent a re-design like any other card, so a fee sold as
 *   "one course plus four revisions" granted four goes in total.
 *
 *   And nothing bounded how many courses a fee could *keep*.
 *   `caddy_courses_per_fee` and `guard_caddy_credit` were dropped when the
 *   counted ledger landed and nothing took the job over, so the invariant
 *   lived in the drafting table's React state — where it was lost on a
 *   reload. A real fee on preview produced two saved courses.
 *
 * Both halves are enforced in Postgres now, and this suite is why that
 * matters: every assertion below goes through PostgREST on a host's own
 * session, which is the only path the app has. A rule the client keeps is a
 * rule anyone with the network tab can break.
 *
 * House rules for the tier hold throughout: `adminClient()` seeds and reads
 * back and is never the subject, and a blocked write is proved by re-reading
 * the row rather than by a null error.
 *
 * **One deliberate departure.** `expectDenied` refuses to count `23505`,
 * because a unique violation usually means a fixture collided rather than an
 * attack being stopped. Here it *is* the refusal — the one-course rule is a
 * unique partial index — so those cases assert the code directly and say so.
 */

const HOUR = 3_600_000;

/**
 * A green fee the way the webhook writes one — **with no clock on it**.
 *
 * That is the fixture's whole point since `20260908000000`: a fee is dormant
 * when bought and the day starts when a round tees off. Seeding one with an
 * expiry would be testing a shape production no longer produces, and would
 * hide the case this file cares most about.
 *
 * `grant_caddy_package` fires on insert, so the grants are the trigger's work
 * and never the fixture's.
 */
async function seedFee(buyer: Actor) {
  const { data, error } = await adminClient()
    .from("entitlements")
    .insert({
      user_id: buyer.userId,
      kind: "green_fee",
      stripe_event_id: `evt_quota_${randomUUID()}`,
      expires_at: null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** A fee whose day has already been started and has since run out — what a
 * host looks like the morning after. */
async function seedSpentFee(buyer: Actor) {
  const { data, error } = await adminClient()
    .from("entitlements")
    .insert({
      user_id: buyer.userId,
      kind: "green_fee",
      stripe_event_id: `evt_quota_${randomUUID()}`,
      activated_at: new Date(Date.now() - 25 * HOUR).toISOString(),
      expires_at: new Date(Date.now() - HOUR).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Spend a whole card the way a plan does, so the session may hold a course.
 *
 * `guard_caddy_course_slot` lets a host keep as many courses as they have
 * spent `course` credits — keyed on what was bought rather than on the
 * purchase row, which is what stops a rung that grants no course from holding
 * one. In production the spend always exists by the time `course_id` is
 * stamped: `runTurn` writes the turn, `guard_caddy_spend` writes the spend off
 * the back of it, and only then does the drafting table remember the course.
 *
 * These fixtures used to stamp the link with no turn behind it, which is a
 * state the app cannot reach — so they were testing the guard against a
 * history that never happens.
 */
async function spendACard(host: Actor, sessionId: string) {
  const { error } = await host.db.from("caddy_turns").insert({
    session_id: sessionId,
    host: host.userId,
    kind: "plan" as const,
    result: { name: "The Crawl", holes: [] },
    model: "claude-sonnet-5",
    input_tokens: 1_000,
    output_tokens: 1_000,
  });
  if (error) throw error;
}

async function seedSession(host: Actor, entitlementId: string | null) {
  const { data, error } = await adminClient()
    .from("caddy_sessions")
    .insert({
      host: host.userId,
      entitlement_id: entitlementId,
      brief: { where: "Shoreditch", holes: 9 },
      dossier: [{ id: "p1", name: "The Old Blue Last" }],
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function seedCourse(owner: Actor, name = "The Shoreditch Nine") {
  const { data, error } = await adminClient()
    .from("courses")
    .insert({ owner: owner.userId, name })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** One turn, as the pipeline writes it — through the host's own session, so
 * `guard_caddy_spend` runs as `authenticated` rather than taking the
 * service_role exemption. That exemption is why seeding a turn with
 * `adminClient()` would prove nothing here. */
async function writeTurn(
  host: Actor,
  sessionId: string,
  kind: "plan" | "roll" | "tweak",
  over: Record<string, unknown> = {},
) {
  return host.db
    .from("caddy_turns")
    .insert({
      session_id: sessionId,
      host: host.userId,
      kind,
      result: { name: "The Crawl", holes: [] },
      model: "claude-sonnet-5",
      input_tokens: 1_000,
      output_tokens: 1_000,
      ...over,
    })
    .select("id")
    .single();
}

/** What the ledger says is left, asked the way the screen asks it. */
async function balance(host: Actor, quota: (typeof CADDY_QUOTAS)[number]) {
  const { data, error } = await host.db.rpc("caddy_balance", {
    who: host.userId,
    quota,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/** Which grant paid for a turn — the question the whole ladder is about. */
async function quotaSpentOn(turnId: string) {
  const { data, error } = await adminClient()
    .from("caddy_spends")
    .select("grant_id, caddy_grants(quota)")
    .eq("turn_id", turnId)
    .maybeSingle();
  if (error) throw error;
  return (data as { caddy_grants: { quota: string } | null } | null)?.caddy_grants
    ?.quota ?? null;
}

async function storedCourseId(sessionId: string) {
  const { data, error } = await adminClient()
    .from("caddy_sessions")
    .select("course_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data?.course_id ?? null;
}

describe("what a green fee grants", () => {
  let host: Actor;

  beforeEach(async () => {
    host = await signedInUser("Fee Holder");
    await seedFee(host);
  });

  it("mints one course, four revisions and sixty tweaks", async () => {
    expect(await balance(host, "course")).toBe(1);
    expect(await balance(host, "redesign")).toBe(4);
    expect(await balance(host, "tweak")).toBe(60);
  });

  it("agrees with the copy that quotes it", async () => {
    // `CADDY_GRANT_SIZE` is a hand-kept mirror of `caddy_grant_size()`, and a
    // number the screen misquotes is a host told they have something they do
    // not. Every quota, so a new one cannot be added on one side alone.
    for (const quota of CADDY_QUOTAS) {
      const { data, error } = await adminClient().rpc("caddy_grant_size", {
        quota,
      });
      expect(error).toBeNull();
      expect(Number(data), `caddy_grant_size(${quota})`).toBe(
        CADDY_GRANT_SIZE[quota],
      );
    }
  });

  it("has exactly the quotas the code knows about", async () => {
    // The mirror test above walks `CADDY_QUOTAS` and would miss a quota that
    // exists in Postgres and not in TypeScript — which is the direction that
    // actually happens, because a migration ships before the code that reads
    // it. `grant_caddy_package` iterates `enum_range`, so an unknown value
    // would be minted with a null amount and read as an unlimited grant.
    const { data, error } = await adminClient().rpc("caddy_grant_size", {
      quota: "course",
    });
    expect(error).toBeNull();
    expect(Number(data)).toBe(1);
    // Every grant this fee minted is a quota the code can name.
    const { data: grants } = await adminClient()
      .from("caddy_grants")
      .select("quota, amount")
      .eq("host", host.userId);
    for (const grant of grants ?? []) {
      expect(CADDY_QUOTAS as readonly string[]).toContain(grant.quota);
      // A null or zero amount reads as unlimited in the balance query, which
      // is the failure mode a missing `case` arm produces.
      expect(grant.amount, `${grant.quota} amount`).toBeGreaterThan(0);
    }
  });

  it("starts no clock at the till", async () => {
    // The whole of `20260908000000`. A fee is consumed at two moments that are
    // rarely the same day — planning, which people do in advance, and playing,
    // which is a specific evening — and dating it at the charge forced them
    // into one. Buy Wednesday to plan a Saturday crawl and the pass was dead
    // by Thursday.
    const { data, error } = await adminClient()
      .from("entitlements")
      .select("expires_at, activated_at")
      .eq("user_id", host.userId)
      .eq("kind", "green_fee")
      .single();
    if (error) throw error;
    expect(data.expires_at).toBeNull();
    expect(data.activated_at).toBeNull();

    const { data: grants } = await adminClient()
      .from("caddy_grants")
      .select("quota, expires_at")
      .eq("host", host.userId);
    expect(grants).toHaveLength(CADDY_QUOTAS.length);
    for (const grant of grants ?? []) {
      expect(grant.expires_at, `${grant.quota} was dated at purchase`).toBeNull();
    }
  });

  it("covers its holder while it is still dormant", async () => {
    // A dormant fee has a null expiry, and `holds_day_pass` reads null as live
    // — the column's own contract, and the reason this change needed no guard
    // rewritten. A host who has paid is covered from the moment they pay.
    const { data, error } = await host.db.rpc("holds_day_pass", {
      who: host.userId,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("counts nothing from a fee whose day has been and gone", async () => {
    const spent = await signedInUser("Yesterday's Host");
    await seedSpentFee(spent);
    expect(await balance(spent, "course")).toBe(0);
    expect(await balance(spent, "redesign")).toBe(0);
  });
});

/**
 * The ladder: a card takes the course credit first, then the revisions.
 *
 * That ordering is what makes "one course plus four revisions" true without a
 * second code path — and it is the thing a test has to pin, because from the
 * outside five goes look identical whichever grant paid for each.
 */
describe("the spend ladder", () => {
  let host: Actor;
  let sessionId: string;

  beforeEach(async () => {
    host = await signedInUser("Ladder Host");
    const fee = await seedFee(host);
    sessionId = await seedSession(host, fee);
  });

  it("takes the course credit for the first card", async () => {
    const { data, error } = await writeTurn(host, sessionId, "plan");
    expect(error).toBeNull();
    expect(await quotaSpentOn(data!.id)).toBe("course");
    expect(await balance(host, "course")).toBe(0);
    expect(await balance(host, "redesign")).toBe(4);
  });

  it("takes a revision for every card after it", async () => {
    const first = await writeTurn(host, sessionId, "plan");
    expect(await quotaSpentOn(first.data!.id)).toBe("course");
    for (let i = 0; i < 4; i += 1) {
      const next = await writeTurn(host, sessionId, "roll");
      expect(next.error, `roll ${i + 1}`).toBeNull();
      expect(await quotaSpentOn(next.data!.id)).toBe("redesign");
    }
    expect(await balance(host, "redesign")).toBe(0);
  });

  it("gives five whole cards and refuses the sixth", async () => {
    // The number the fee is sold on. One course plus four revisions.
    await writeTurn(host, sessionId, "plan");
    for (let i = 0; i < 4; i += 1) await writeTurn(host, sessionId, "roll");

    const sixth = await writeTurn(host, sessionId, "roll");
    expectDenied(sixth.error);
    expect(sixth.error?.message).toMatch(/revisions/i);
  });

  it("never lets a tweak eat a card, or a card eat a tweak", async () => {
    const tweak = await writeTurn(host, sessionId, "tweak");
    expect(await quotaSpentOn(tweak.data!.id)).toBe("tweak");
    // The card ladder is untouched by it — which is the whole reason tweaks
    // are their own quota rather than a fraction of a re-design.
    expect(await balance(host, "course")).toBe(1);
    expect(await balance(host, "redesign")).toBe(4);
    expect(await balance(host, "tweak")).toBe(59);
  });

  it("charges nothing for a turn that produced no card", async () => {
    // The promise the `failed` column keeps: the tokens are still owed to the
    // vendor and still recorded, but the host is not charged a credit for a
    // card they never received.
    const failed = await writeTurn(host, sessionId, "plan", {
      failed: true,
      result: {},
    });
    expect(failed.error).toBeNull();
    expect(await quotaSpentOn(failed.data!.id)).toBeNull();
    expect(await balance(host, "course")).toBe(1);
  });

  it("refuses a host with no fee at all", async () => {
    const broke = await signedInUser("No Fee");
    const theirs = await seedSession(broke, null);
    const turn = await writeTurn(broke, theirs, "plan");
    expectDenied(turn.error);
  });

  it("holds under two cards racing for the last credit", async () => {
    // 20260816's scar, in the shape this change gave it. The lock key used to
    // be per-quota; the course→revision fallback means a plan and a roll can
    // now reach for *different* rungs of the same ladder at the same instant,
    // so the key had to widen to the ladder. Two turns at once on a fee with
    // one card left is exactly that race.
    const solo = await signedInUser("Racing Host");
    const fee = await seedFee(solo);
    const theirs = await seedSession(solo, fee);
    // Burn everything but one.
    await writeTurn(solo, theirs, "plan");
    for (let i = 0; i < 3; i += 1) await writeTurn(solo, theirs, "roll");
    expect(await balance(solo, "redesign")).toBe(1);

    const both = await Promise.all([
      writeTurn(solo, theirs, "roll"),
      writeTurn(solo, theirs, "roll"),
    ]);
    const landed = both.filter((r) => r.error === null);
    expect(landed, "exactly one card should get the last credit").toHaveLength(1);
    expect(await balance(solo, "redesign")).toBe(0);
  });
});

/**
 * Every rung of the tariff grants what the tariff says it grants.
 *
 * `caddy_topup_course` shipped and granted **nothing** — the purchase went
 * through, the entitlement row was written, and the buyer got no course, no
 * revision and no tweaks. Money taken, nothing given, which is the worst
 * failure a billing path has.
 *
 * `grant_caddy_package` decided whether a row was a top-up by testing
 * `new.kind` against a hardcoded list of the two rungs that existed when it was
 * written. The migration that added the third taught `caddy_topup_size` and
 * restated the CHECK — both necessary — while the trigger in between went on
 * saying "never heard of it" and fell through.
 *
 * It is the second time this shape has bitten: `caddy_topup_1` first shipped
 * unable to be inserted at all, because a *different* hardcoded list — the
 * CHECK constraint — had never heard of it either. So this suite walks
 * `CADDY_TOPUP_LOOKUP_KEYS` rather than naming rungs, which is the only way a
 * test can catch the next one.
 */
describe("what every top-up grants", () => {
  let buyer: Actor;

  beforeEach(async () => {
    buyer = await signedInUser("Top-up Buyer");
  });

  async function buy(kind: CaddyTopupKey) {
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

  async function grantsFor(entitlementId: string) {
    const { data, error } = await adminClient()
      .from("caddy_grants")
      .select("quota, amount, expires_at")
      .eq("entitlement_id", entitlementId);
    if (error) throw error;
    return data ?? [];
  }

  it("grants something for every rung the code sells", async () => {
    // The regression, and deliberately a loop rather than three named cases:
    // the bug was a rung the database had never heard of, so a test that names
    // rungs would have been written against the same stale list.
    for (const kind of CADDY_TOPUP_LOOKUP_KEYS) {
      const bought = await buy(kind);
      expect(
        await grantsFor(bought),
        `${kind} granted nothing — money taken, nothing given`,
      ).not.toHaveLength(0);
    }
  });

  it("grants exactly what the tariff prints", async () => {
    for (const kind of CADDY_TOPUP_LOOKUP_KEYS) {
      const bought = await buy(kind);
      const granted = Object.fromEntries(
        (await grantsFor(bought)).map((g) => [g.quota, g.amount]),
      );
      const tariff = CADDY_TOPUPS[kind];
      expect(granted.redesign, `${kind} revisions`).toBe(tariff.redesign);
      expect(granted.tweak, `${kind} tweaks`).toBe(tariff.tweak);
      // A rung with no course credit must not quietly acquire one: that is the
      // difference between "another round" and "another course", and it is the
      // whole reason the two are separate products.
      expect(granted.course, `${kind} course credit`).toBe(tariff.course);
    }
  });

  it("keeps every top-up durable, whatever the rung", async () => {
    // Cost is incurred at redemption, so an unredeemed round costs nothing to
    // hold and expiring one would earn breakage and nothing else. The fee is
    // the only thing here with a clock, and even that one starts at tee-off.
    for (const kind of CADDY_TOPUP_LOOKUP_KEYS) {
      for (const grant of await grantsFor(await buy(kind))) {
        expect(grant.expires_at, `${kind} ${grant.quota} expires`).toBeNull();
      }
    }
  });

  it("grants nothing at all for a kind the tariff does not sell", async () => {
    // The fall-through has to stay a fall-through. `season_ticket` is in the
    // CHECK constraint and sells nothing today, so it is the honest probe for
    // "recognised by the column, unknown to the tariff".
    const { data } = await adminClient()
      .from("entitlements")
      .insert({
        user_id: buyer.userId,
        kind: "season_ticket",
        stripe_event_id: `evt_topup_${randomUUID()}`,
        expires_at: null,
      })
      .select("id")
      .single();
    expect(await grantsFor(data!.id)).toHaveLength(0);
  });
});

/**
 * The day starts when the round does.
 *
 * A fee is consumed at two moments that are rarely the same day — planning,
 * which people do in advance, and playing, which is a specific evening. Running
 * the clock from the charge forced them into one: buy on Wednesday to plan a
 * Saturday crawl and the pass was dead by Thursday, with nothing on the way in
 * saying so.
 *
 * Worth noting how little the clock was holding up, because it is the argument
 * for moving it. The caddy half is bounded by counts. The round half is
 * `guard_round_members` stamping `members` once. And "do not hold Google's data
 * indefinitely" is answered by the twelve-hour dossier window, somewhere else
 * entirely.
 */
describe("when the green fee's day starts", () => {
  let host: Actor;
  let fee: string;

  beforeEach(async () => {
    host = await signedInUser("Planning Ahead");
    fee = await seedFee(host);
  });

  async function feeRow() {
    const { data, error } = await adminClient()
      .from("entitlements")
      .select("activated_at, expires_at")
      .eq("id", fee)
      .single();
    if (error) throw error;
    return data;
  }

  it("agrees with the copy about how long a day is", async () => {
    // `DAY_PASS_HOURS` and `day_pass_hours()` decide the same thing from
    // different sides, and a host whose screen and database disagree about
    // when their pass ends has been lied to by one of them.
    const { data, error } = await adminClient().rpc("day_pass_hours");
    expect(error).toBeNull();
    expect(Number(data)).toBe(DAY_PASS_HOURS);
  });

  it("starts the day, once, and dates the credits with it", async () => {
    const { error } = await host.db.rpc("activate_day_pass", {
      who: host.userId,
    });
    expect(error).toBeNull();

    const started = await feeRow();
    expect(started.activated_at).not.toBeNull();
    expect(started.expires_at).not.toBeNull();
    const hours =
      (Date.parse(started.expires_at!) - Date.parse(started.activated_at!)) /
      HOUR;
    expect(Math.round(hours)).toBe(DAY_PASS_HOURS);

    // The credits were minted durable — `grant_caddy_package` copies the
    // entitlement's expiry, and a dormant fee has none — so without the
    // cascade they would outlive the day they belong to.
    const { data: grants } = await adminClient()
      .from("caddy_grants")
      .select("quota, expires_at")
      .eq("entitlement_id", fee);
    for (const grant of grants ?? []) {
      expect(grant.expires_at, `${grant.quota} outlives the day`).not.toBeNull();
    }
  });

  it("does not restart a day already running", async () => {
    // Idempotent by construction: it only ever matches a row with a null
    // `activated_at`. A second round the same night must not buy another day.
    await host.db.rpc("activate_day_pass", { who: host.userId });
    const first = await feeRow();
    await host.db.rpc("activate_day_pass", { who: host.userId });
    expect((await feeRow()).activated_at).toBe(first.activated_at);
    expect((await feeRow()).expires_at).toBe(first.expires_at);
  });

  it("starts the oldest dormant fee first", async () => {
    // Somebody holding two spends the one they bought first.
    const second = await adminClient()
      .from("entitlements")
      .insert({
        user_id: host.userId,
        kind: "green_fee",
        stripe_event_id: `evt_quota_${randomUUID()}`,
        expires_at: null,
      })
      .select("id")
      .single();
    await host.db.rpc("activate_day_pass", { who: host.userId });

    expect((await feeRow()).activated_at).not.toBeNull();
    const { data: newer } = await adminClient()
      .from("entitlements")
      .select("activated_at")
      .eq("id", second.data!.id)
      .single();
    expect(newer?.activated_at).toBeNull();
  });

  it("does nothing for a host with no dormant fee", async () => {
    // Not an error — a round teeing off uncovered reaches this and must not
    // fail because of it.
    const nobody = await signedInUser("No Fee At All");
    const { error } = await nobody.db.rpc("activate_day_pass", {
      who: nobody.userId,
    });
    expect(error).toBeNull();
  });
});

/**
 * One filed course per fee.
 *
 * The half that was never enforced anywhere, and the reason a single fee on
 * preview has two saved courses. Four revisions are four attempts at the same
 * course; four of them amounting to four *kept* courses would be four
 * evenings' work sold for the price of one.
 */
describe("a fee files one course", () => {
  let host: Actor;
  let fee: string;

  beforeEach(async () => {
    host = await signedInUser("One Course Host");
    fee = await seedFee(host);
  });

  it("lets the fee file its course", async () => {
    const sessionId = await seedSession(host, fee);
    await spendACard(host, sessionId);
    const courseId = await seedCourse(host);
    const { error } = await host.db
      .from("caddy_sessions")
      .update({ course_id: courseId })
      .eq("id", sessionId);
    expect(error).toBeNull();
    expect(await storedCourseId(sessionId)).toBe(courseId);
  });

  it("refuses a second course on the same fee", async () => {
    // The bug, exactly: a host plans twice, so there are two sessions under
    // one fee, and the second files a course of its own. Both plans spend —
    // the first off the fee's one `course` credit, the second off a
    // re-design — so the second has no course credit behind it.
    const first = await seedSession(host, fee);
    const second = await seedSession(host, fee);
    await spendACard(host, first);
    await spendACard(host, second);
    await host.db
      .from("caddy_sessions")
      .update({ course_id: await seedCourse(host, "The First") })
      .eq("id", first);

    const { error } = await host.db
      .from("caddy_sessions")
      .update({ course_id: await seedCourse(host, "The Second") })
      .eq("id", second);

    // 42501, and it used to be 23505. The rule was a unique partial index on
    // the *purchase* until `guard_caddy_course_slot` re-keyed it on the
    // `course` credit — which is what stops `caddy_topup_1`, a rung that
    // grants no course at all, from holding one. A trigger rather than an
    // index because it is a count across sibling rows, which no `with check`
    // can see. The re-read is what actually proves it, per the tier's own
    // rule about writes that report success.
    expect(error?.code).toBe("42501");
    expect(await storedCourseId(second)).toBeNull();
  });

  it("frees the fee when the course is torn out of the book", async () => {
    // The release valve, and it is deliberate rather than incidental: a host
    // who does not like what they got should be able to bin it and spend a
    // revision on something else. `course_id` is `on delete set null`, so the
    // slot opens the moment the course goes.
    //
    // **This test found a real bug, and it is the reason to write it.** The
    // one-way guard from `20260827000000` fired on the foreign key's own
    // `set null` — that action runs inside the host's request, where the JWT
    // still says `authenticated` — so *every* caddy-planned course was
    // undeletable, and the host was told "A caddy session keeps the course it
    // filed" for pressing a button about their own book. `20260907000000`
    // narrows the guard to what it was always about: re-pointing. See the two
    // tests below, which are the half of it that must not be lost.
    const first = await seedSession(host, fee);
    await spendACard(host, first);
    const doomed = await seedCourse(host, "The Regrettable");
    await host.db
      .from("caddy_sessions")
      .update({ course_id: doomed })
      .eq("id", first);

    const { error: tornOut } = await host.db
      .from("courses")
      .delete()
      .eq("id", doomed);
    expect(tornOut).toBeNull();
    expect(await storedCourseId(first)).toBeNull();

    const second = await seedSession(host, fee);
    await spendACard(host, second);
    const { error } = await host.db
      .from("caddy_sessions")
      .update({ course_id: await seedCourse(host, "The Replacement") })
      .eq("id", second);
    expect(error).toBeNull();
  });

  it("counts each fee separately", async () => {
    // Two fees, two courses. The rule is per fee, not per host — somebody who
    // pays twice gets what they paid for twice.
    const secondFee = await seedFee(host);
    const a = await seedSession(host, fee);
    const b = await seedSession(host, secondFee);
    // One plan each: two fees are two `course` credits, and the rule counts
    // credits *spent*, so both have to be.
    await spendACard(host, a);
    await spendACard(host, b);
    const first = await host.db
      .from("caddy_sessions")
      .update({ course_id: await seedCourse(host, "Fee One") })
      .eq("id", a);
    const second = await host.db
      .from("caddy_sessions")
      .update({ course_id: await seedCourse(host, "Fee Two") })
      .eq("id", b);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(await storedCourseId(b)).not.toBeNull();
  });

  it("does not constrain a session with no fee behind it", async () => {
    // Nulls are distinct in a unique index, and the column is nullable. Worth
    // pinning: a comped session is the obvious future one, and it should not
    // silently share a slot with every other comped session on the stack.
    const a = await seedSession(host, null);
    const b = await seedSession(host, null);
    await adminClient()
      .from("caddy_sessions")
      .update({ course_id: await seedCourse(host, "Comped One") })
      .eq("id", a);
    const { error } = await adminClient()
      .from("caddy_sessions")
      .update({ course_id: await seedCourse(host, "Comped Two") })
      .eq("id", b);
    expect(error).toBeNull();
  });

  it("still refuses a link walked to a different course", async () => {
    // The rule `20260827000000` exists for, and the one the delete fix must
    // not cost. A movable link is a way to make the duplicate it prevents.
    const sessionId = await seedSession(host, fee);
    await spendACard(host, sessionId);
    const first = await seedCourse(host, "The One It Filed");
    await host.db
      .from("caddy_sessions")
      .update({ course_id: first })
      .eq("id", sessionId);

    const elsewhere = await seedCourse(host, "Somewhere Else");
    const { error } = await host.db
      .from("caddy_sessions")
      .update({ course_id: elsewhere })
      .eq("id", sessionId);
    expectDenied(error);
    expect(await storedCourseId(sessionId)).toBe(first);
  });

  it("still refuses the link being nulled by hand", async () => {
    // The obvious way round the rule above: clear it, then point somewhere
    // else. `course_id` is in the host's column grant, so this has to be
    // refused explicitly — and it is what makes "the course is gone" the only
    // way the link can be cleared.
    const sessionId = await seedSession(host, fee);
    await spendACard(host, sessionId);
    const filed = await seedCourse(host, "Still In The Book");
    await host.db
      .from("caddy_sessions")
      .update({ course_id: filed })
      .eq("id", sessionId);

    const { error } = await host.db
      .from("caddy_sessions")
      .update({ course_id: null })
      .eq("id", sessionId);
    expectDenied(error);
    expect(await storedCourseId(sessionId)).toBe(filed);
  });

  it("keeps another host's fee out of it entirely", async () => {
    // RLS first, rule second. A stranger cannot see this session, so their
    // write matches no rows — silence rather than a constraint violation, and
    // the stored row is what proves it.
    const stranger = await signedInUser("Passing Stranger");
    const sessionId = await seedSession(host, fee);
    const { error } = await stranger.db
      .from("caddy_sessions")
      .update({ course_id: await seedCourse(stranger, "Not Yours") })
      .eq("id", sessionId);
    expect(error).toBeNull();
    expect(await storedCourseId(sessionId)).toBeNull();
  });
});
