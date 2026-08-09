import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  adminClient,
  anonymousGuest,
  signedInUser,
  visitor,
  type Actor,
} from "@/tests/support/clients";
import { seedRound, type SeededRound } from "@/tests/support/factories";

import { expectDenied } from "./helpers/assert";

/** Seed a paid green fee the way the webhook would: service role, one row. */
async function seedGreenFee(round: SeededRound, buyer: Actor) {
  const { data, error } = await adminClient()
    .from("entitlements")
    .insert({
      user_id: buyer.userId,
      round_id: round.id,
      kind: "green_fee",
      stripe_event_id: `evt_test_${randomUUID()}`,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

async function storedEntitlement(id: string) {
  const { data, error } = await adminClient()
    .from("entitlements")
    .select("id, kind, round_id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Entitlements have exactly one author — the Stripe webhook, as
 * service_role. There are no write policies at all, so the whole security
 * story of the table is that the app can only ever look.
 */
describe("entitlements", () => {
  let host: Actor;
  let guest: Actor;
  let stranger: Actor;
  let round: SeededRound;

  beforeEach(async () => {
    [host, guest, stranger] = await Promise.all([
      signedInUser("Host"),
      anonymousGuest("Guest"),
      signedInUser("Stranger"),
    ]);
    round = await seedRound({ host, players: [guest], status: "live" });
  });

  it("is readable by everyone seated — premium features render for the whole table", async () => {
    const row = await seedGreenFee(round, host);
    for (const actor of [host, guest]) {
      const { data, error } = await actor.db
        .from("entitlements")
        .select("id, kind")
        .eq("round_id", round.id);
      expect(error).toBeNull();
      expect(data?.map((r) => r.id)).toContain(row.id);
    }
  });

  it("shows a stranger and a visitor nothing", async () => {
    await seedGreenFee(round, host);

    const { data: strangerSees, error: strangerError } = await stranger.db
      .from("entitlements")
      .select("id")
      .eq("round_id", round.id);
    expect(strangerError).toBeNull();
    expect(strangerSees).toEqual([]);

    // The anon role holds the grant but no policy: zero rows, no error.
    const { data: visitorSees, error: visitorError } = await visitor()
      .from("entitlements")
      .select("id")
      .eq("round_id", round.id);
    expect(visitorError).toBeNull();
    expect(visitorSees).toEqual([]);
  });

  it("shows a user-scoped row (no round) to its owner alone", async () => {
    const { data: ticket, error } = await adminClient()
      .from("entitlements")
      .insert({
        user_id: host.userId,
        kind: "season_ticket",
        stripe_event_id: `evt_test_${randomUUID()}`,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { data: ownerSees } = await host.db
      .from("entitlements")
      .select("id")
      .eq("id", ticket.id);
    expect(ownerSees?.map((r) => r.id)).toContain(ticket.id);

    const { data: guestSees } = await guest.db
      .from("entitlements")
      .select("id")
      .eq("id", ticket.id);
    expect(guestSees).toEqual([]);
  });

  it("cannot be forged from any seat — the webhook is the only author", async () => {
    for (const actor of [host, guest, stranger]) {
      const { error } = await actor.db.from("entitlements").insert({
        user_id: actor.userId,
        round_id: round.id,
        kind: "green_fee",
        stripe_event_id: `evt_forged_${randomUUID()}`,
      });
      expectDenied(error);
    }
  });

  it("cannot be retargeted or retracted by its buyer", async () => {
    const row = await seedGreenFee(round, host);

    // An UPDATE or DELETE the policy filters out reports success and touches
    // nothing — so the proof is the stored row, read back past RLS.
    await host.db
      .from("entitlements")
      .update({ kind: "season_ticket" })
      .eq("id", row.id);
    await host.db.from("entitlements").delete().eq("id", row.id);

    const stored = await storedEntitlement(row.id);
    expect(stored?.kind).toBe("green_fee");
  });

  it("holds one green fee per round, whoever races for it", async () => {
    await seedGreenFee(round, host);
    const { error } = await adminClient().from("entitlements").insert({
      user_id: guest.userId,
      round_id: round.id,
      kind: "green_fee",
      stripe_event_id: `evt_test_${randomUUID()}`,
    });
    expect(error?.code).toBe("23505");
  });
});
