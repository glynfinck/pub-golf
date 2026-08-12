import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { adminClient, signedInUser, type Actor } from "@/tests/support/clients";

import { expectDenied } from "./helpers/assert";

/**
 * Five doors an adversarial audit found open, kept shut.
 *
 * Every one of them was the same mistake in a different costume: **a rule the
 * application kept that Postgres did not.** Every action in this app reaches
 * the database through PostgREST on the caller's own session, so anything the
 * client is trusted to get right is something anyone with the network tab can
 * get wrong on purpose — and four of these five needed nothing but a single
 * POST from an ordinary signed-in account.
 *
 * They are grouped here rather than filed among the feature suites because
 * that is the shape worth recognising: a `security definer` function taking an
 * arbitrary uuid, a policy written `using (true)`, a foreign key mistaken for
 * an access check. This file is the standing test for that shape.
 *
 * Two of them shipped in the same day as the migration that fixed them, which
 * is the argument for the suite existing rather than for anybody trying
 * harder.
 */

describe("a definer function may not act on a stranger", () => {
  let mine: Actor;
  let theirs: Actor;

  beforeEach(async () => {
    [mine, theirs] = await Promise.all([
      signedInUser("Ledger Owner"),
      signedInUser("Passing Stranger"),
    ]);
  });

  it("refuses to start somebody else's day", async () => {
    // `activate_day_pass(who uuid)` is definer, takes an arbitrary uuid and
    // performs two writes. Granted to `authenticated` it was one POST to burn
    // a stranger's green fee — start their 24 hours and date every credit they
    // had not spent. It is now callable by nobody but the guard.
    const { error } = await mine.db.rpc("activate_day_pass", {
      who: theirs.userId,
    });
    expect(error).not.toBeNull();
    expect(error?.code, "activate_day_pass is still reachable").toBe("42501");
  });

  it("refuses to start even your own day by hand", async () => {
    // Not "you may only start yours" — nobody starts a day by hand. Tee-off is
    // the only thing that starts one, and it goes through the guard.
    const { error } = await mine.db.rpc("activate_day_pass", {
      who: mine.userId,
    });
    expect(error?.code).toBe("42501");
  });

  it("refuses to read a stranger's balance", async () => {
    const { error } = await mine.db.rpc("caddy_balance", {
      who: theirs.userId,
      quota: "redesign",
    });
    expectDenied(error);
  });

  it("refuses to hand over a stranger's grant", async () => {
    const { error } = await mine.db.rpc("caddy_next_grant", {
      who: theirs.userId,
      quota: "redesign",
    });
    expectDenied(error);
  });

  it("still answers a host about their own ledger", async () => {
    // The narrowing must not cost the honest path. Every real caller —
    // `liveFee`, `caddyAllowance`, `guard_caddy_spend` — passes its own uid.
    await adminClient().from("entitlements").insert({
      user_id: mine.userId,
      kind: "green_fee",
      stripe_event_id: `evt_doors_${randomUUID()}`,
      expires_at: null,
    });
    const { data, error } = await mine.db.rpc("caddy_balance", {
      who: mine.userId,
      quota: "redesign",
    });
    expect(error).toBeNull();
    expect(Number(data)).toBeGreaterThan(0);
  });
});

describe("the shared pub cache keeps its identities", () => {
  let attacker: Actor;
  let venueId: string;

  beforeEach(async () => {
    attacker = await signedInUser("Cache Vandal");
    const { data, error } = await adminClient()
      .from("venues")
      .insert({
        name: "The Old Blue Last",
        address: "38 Great Eastern St",
        lat: 51.52441,
        lng: -0.08013,
        google_place_id: `place_${randomUUID()}`,
        rating: 4.2,
        review_count: 900,
      })
      .select("id")
      .single();
    if (error) throw error;
    venueId = data.id;
  });

  async function stored() {
    const { data, error } = await adminClient()
      .from("venues")
      .select("name, address, lat, lng, rating")
      .eq("id", venueId)
      .single();
    if (error) throw error;
    return data;
  }

  it("refuses to rename a pub for everybody", async () => {
    // `venues` is the cache every course and every round reads a pub's name
    // and coordinates out of, and the policy was `using (true) with check
    // (true)`. This is the shortest path in the codebase to a group standing
    // outside a door that is not there.
    const { error } = await attacker.db
      .from("venues")
      .update({ name: "The Nonexistent Arms" })
      .eq("id", venueId);
    expectDenied(error);
    expect((await stored()).name).toBe("The Old Blue Last");
  });

  it("refuses to move a pub", async () => {
    const { error } = await attacker.db
      .from("venues")
      .update({ lat: 55.9533, lng: -3.1883 })
      .eq("id", venueId);
    expectDenied(error);
    expect((await stored()).lat).toBeCloseTo(51.52441, 4);
  });

  it("refuses to repoint a pub at a different Google place", async () => {
    const { error } = await attacker.db
      .from("venues")
      .update({ google_place_id: `place_${randomUUID()}` })
      .eq("id", venueId);
    expectDenied(error);
  });

  it("still lets the search refresh what a refresh is for", async () => {
    // The narrowing the old policy's comment described and never expressed:
    // how good a pub is, and when we last looked.
    const { error } = await attacker.db
      .from("venues")
      .update({ rating: 4.5, review_count: 1200, fetched_at: new Date().toISOString() })
      .eq("id", venueId);
    expect(error).toBeNull();
    expect((await stored()).rating).toBeCloseTo(4.5, 2);
  });
});

describe("a foreign key is not an access check", () => {
  let owner: Actor;
  let stranger: Actor;
  let purchase: string;

  beforeEach(async () => {
    [owner, stranger] = await Promise.all([
      signedInUser("Fee Owner"),
      signedInUser("Slot Squatter"),
    ]);
    const { data, error } = await adminClient()
      .from("entitlements")
      .insert({
        user_id: owner.userId,
        kind: "green_fee",
        stripe_event_id: `evt_doors_${randomUUID()}`,
        expires_at: null,
      })
      .select("id")
      .single();
    if (error) throw error;
    purchase = data.id;
  });

  it("refuses a session opened against a stranger's purchase", async () => {
    // Referential-integrity checks run with row security **off**, so the FK
    // happily resolved a row the inserting user could not see. Point a session
    // at somebody else's fee, file a course on it, and you have occupied the
    // one-course slot of a purchase you did not make.
    const { error } = await stranger.db.from("caddy_sessions").insert({
      host: stranger.userId,
      entitlement_id: purchase,
      brief: { where: "Shoreditch", holes: 9 },
      dossier: [{ id: "p1" }],
    });
    expectDenied(error);
  });

  it("still lets a host open a session on their own purchase", async () => {
    const { error } = await owner.db.from("caddy_sessions").insert({
      host: owner.userId,
      entitlement_id: purchase,
      brief: { where: "Shoreditch", holes: 9 },
      dossier: [{ id: "p1" }],
    });
    expect(error).toBeNull();
  });

  it("still lets a session carry no purchase at all", async () => {
    // Nullable on purpose — a comped session is the obvious future one.
    const { error } = await owner.db.from("caddy_sessions").insert({
      host: owner.userId,
      entitlement_id: null,
      brief: { where: "Shoreditch", holes: 9 },
      dossier: [{ id: "p1" }],
    });
    expect(error).toBeNull();
  });

  it("refuses a report naming a stranger's conversation", async () => {
    // The same shape on the report link. `lib/actions/support.ts` asserted the
    // opposite in a comment — "a stranger's id would be refused by the
    // constraint on a row they cannot read" — which is a reasonable thing to
    // assume about foreign keys and not how they behave.
    const { data: session } = await adminClient()
      .from("caddy_sessions")
      .insert({
        host: owner.userId,
        entitlement_id: purchase,
        brief: { where: "Shoreditch", holes: 9 },
        dossier: [{ id: "p1" }],
      })
      .select("id")
      .single();

    const { error } = await stranger.db.from("bug_reports").insert({
      reporter: stranger.userId,
      area: "courses",
      body: "Fishing for somebody else's planning session.",
      caddy_session_id: session!.id,
    });
    expectDenied(error);
  });

  it("still lets a reporter name their own conversation", async () => {
    const { data: session } = await adminClient()
      .from("caddy_sessions")
      .insert({
        host: owner.userId,
        entitlement_id: purchase,
        brief: { where: "Shoreditch", holes: 9 },
        dossier: [{ id: "p1" }],
      })
      .select("id")
      .single();

    const { error } = await owner.db.from("bug_reports").insert({
      reporter: owner.userId,
      area: "courses",
      body: "The third pub on this card is shut on Mondays.",
      caddy_session_id: session!.id,
    });
    expect(error).toBeNull();
  });

  /**
   * The same shape one level down, on the turn.
   *
   * A session is up to sixty-five cards, so a report that names only the
   * session leaves whoever triages it guessing which one went wrong.
   * `caddy_turn_id` narrows it — and needs its own guard for the reason the
   * session link needed one: a foreign key check runs with row security off,
   * so the reference proves the turn exists and nothing about whose it is.
   */
  async function turnFor(host: { userId: string }) {
    const { data: session } = await adminClient()
      .from("caddy_sessions")
      .insert({
        host: host.userId,
        brief: { where: "Shoreditch", holes: 9 },
        dossier: [{ id: "p1" }],
      })
      .select("id")
      .single();
    const { data: turn } = await adminClient()
      .from("caddy_turns")
      .insert({
        session_id: session!.id,
        host: host.userId,
        kind: "plan",
        result: { name: "A card", holes: [] },
      })
      .select("id")
      .single();
    return { sessionId: session!.id, turnId: turn!.id };
  }

  it("refuses a report naming a stranger's card", async () => {
    const theirs = await turnFor(owner);
    const mine = await turnFor(stranger);
    const { error } = await stranger.db.from("bug_reports").insert({
      reporter: stranger.userId,
      area: "courses",
      body: "Fishing for somebody else's card.",
      caddy_session_id: mine.sessionId,
      caddy_turn_id: theirs.turnId,
    });
    expectDenied(error);
  });

  it("lets a reporter name their own card", async () => {
    const mine = await turnFor(owner);
    const { error } = await owner.db.from("bug_reports").insert({
      reporter: owner.userId,
      area: "courses",
      body: "Hole four is a Wetherspoons and we asked for none.",
      caddy_session_id: mine.sessionId,
      caddy_turn_id: mine.turnId,
    });
    expect(error).toBeNull();
  });

  it("still takes a report that names no card at all", async () => {
    // The profile screen files one of these, and a drafting table that has
    // planned nothing files one too. Both ids stay nullable for good.
    const { error } = await owner.db.from("bug_reports").insert({
      reporter: owner.userId,
      area: "other",
      body: "The masthead sweeps the wrong way on a fold.",
    });
    expect(error).toBeNull();
  });
});
