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
import type { Json } from "@/types/database";

import { expectDenied } from "./helpers/assert";

const HOUR = 3_600_000;

/** Mint a day pass the way the webhook would: service role, one row. */
async function seedDayPass(buyer: Actor, expiresInMs: number | null) {
  const { error } = await adminClient().from("entitlements").insert({
    user_id: buyer.userId,
    round_id: null,
    kind: "green_fee",
    stripe_event_id: `evt_test_${randomUUID()}`,
    expires_at:
      expiresInMs === null
        ? null
        : new Date(Date.now() + expiresInMs).toISOString(),
  });
  if (error) throw error;
}

/** Is the round covered, read past RLS — never through the attacker. */
async function covered(roundId: string): Promise<boolean> {
  const { data, error } = await adminClient()
    .from("rounds")
    .select("ruleset")
    .eq("id", roundId)
    .single();
  if (error) throw error;
  const ruleset = data.ruleset as Record<string, unknown> | null;
  return ruleset?.members === true;
}

/** Tee a round off the way startRound does, stamping the flag with it. */
function teeOff(actor: Actor, round: SeededRound, ruleset: Json) {
  return actor.db
    .from("rounds")
    .update({ status: "live", current_hole: 1, ruleset })
    .eq("id", round.id);
}

/**
 * The green fee is a day pass, and what a round keeps of it is one boolean
 * in its own ruleset snapshot — stamped at tee-off, checked once, never
 * again. Which makes that boolean the thing worth attacking: it is a paid
 * receipt to anyone who can set it, and a shredded one to anyone who can
 * unset it. The whole defence is `guard_round_members`, and this is its
 * suite.
 *
 * The stamp granted the league until the league went free, and the suite is
 * unchanged by that: what is guarded is whether the record is true, which is
 * a question the flag has to keep answering whether or not anything is
 * currently reading it.
 *
 * House rule for this tier throughout: an UPDATE the guard refuses raises,
 * but an UPDATE a *policy* filters returns no error and no rows — so every
 * assertion here reads the stored row back through the admin client rather
 * than trusting a response.
 */
describe("the green fee day pass", () => {
  let host: Actor;
  let caddy: Actor;
  let guest: Actor;
  let stranger: Actor;
  let round: SeededRound;

  beforeEach(async () => {
    [host, caddy, guest, stranger] = await Promise.all([
      signedInUser("Host"),
      signedInUser("Caddy"),
      anonymousGuest("Guest"),
      signedInUser("Stranger"),
    ]);
    round = await seedRound({
      host,
      players: [{ ...caddy, role: "caddy" }, guest],
      status: "lobby",
    });
  });

  describe("holds_day_pass", () => {
    it("is false with no pass, true inside the window", async () => {
      const { data: before } = await host.db.rpc("holds_day_pass", {
        who: host.userId,
      });
      expect(before).toBe(false);

      await seedDayPass(host, 12 * HOUR);
      const { data: after } = await host.db.rpc("holds_day_pass", {
        who: host.userId,
      });
      expect(after).toBe(true);
    });

    it("is false once the day is out", async () => {
      await seedDayPass(host, -HOUR);
      const { data } = await host.db.rpc("holds_day_pass", {
        who: host.userId,
      });
      expect(data).toBe(false);
    });

    it("reads a null expiry as a pass that never runs out", async () => {
      await seedDayPass(host, null);
      const { data } = await host.db.rpc("holds_day_pass", {
        who: host.userId,
      });
      expect(data).toBe(true);
    });

    it("answers a caddy about the host — the other person who tees off", async () => {
      // A day pass carries no round, so the entitlements policy shows it to
      // its buyer alone: the caddy cannot read the row and must still be
      // able to tee a covered round off.
      await seedDayPass(host, 12 * HOUR);
      const { data: seen } = await caddy.db
        .from("entitlements")
        .select("id")
        .eq("user_id", host.userId);
      expect(seen).toEqual([]);

      const { data } = await caddy.db.rpc("holds_day_pass", {
        who: host.userId,
      });
      expect(data).toBe(true);
    });

    it("is refused to a visitor with no session", async () => {
      await seedDayPass(host, 12 * HOUR);
      const { error } = await visitor().rpc("holds_day_pass", {
        who: host.userId,
      });
      expect(error).not.toBeNull();
    });
  });

  describe("stamping at tee-off", () => {
    it("admits the flag while the host holds a pass", async () => {
      await seedDayPass(host, 12 * HOUR);
      const { error } = await teeOff(host, round, {
        format: "stroke",
        members: true,
      });
      expect(error).toBeNull();
      expect(await covered(round.id)).toBe(true);
    });

    it("lets the caddy stamp the host's pass, not their own", async () => {
      await seedDayPass(caddy, 12 * HOUR);
      const { error: onCaddysPass } = await teeOff(caddy, round, {
        members: true,
      });
      expectDenied(onCaddysPass);
      expect(await covered(round.id)).toBe(false);

      // The pass that matters is the round's host's, whoever calls the hole.
      await seedDayPass(host, 12 * HOUR);
      const { error } = await teeOff(caddy, round, { members: true });
      expect(error).toBeNull();
      expect(await covered(round.id)).toBe(true);
    });

    it("refuses the flag with no pass at all", async () => {
      const { error } = await teeOff(host, round, { members: true });
      expectDenied(error);
      expect(await covered(round.id)).toBe(false);
    });

    it("refuses the flag on a pass that has run out", async () => {
      await seedDayPass(host, -60_000);
      const { error } = await teeOff(host, round, { members: true });
      expectDenied(error);
      expect(await covered(round.id)).toBe(false);
    });

    it("takes only a real boolean, never the string that looks like one", async () => {
      await seedDayPass(host, 12 * HOUR);
      const { error } = await host.db
        .from("rounds")
        .update({ ruleset: { members: "true" } })
        .eq("id", round.id);
      // Not refused — it is simply not the flag, on either side of the wire.
      expect(error).toBeNull();
      expect(await covered(round.id)).toBe(false);
    });

    it("leaves the rest of the snapshot alone on the way through", async () => {
      await seedDayPass(host, 12 * HOUR);
      const dealt = {
        format: "stableford",
        mulligans: 3,
        penalties: [{ strokes: 2, reason: "Queue jumping" }],
        members: true,
      };
      const { error } = await teeOff(host, round, dealt);
      expect(error).toBeNull();

      const { data } = await adminClient()
        .from("rounds")
        .select("ruleset")
        .eq("id", round.id)
        .single();
      expect(data?.ruleset).toEqual(dealt);
    });
  });

  describe("a round is born uncovered", () => {
    it("refuses the flag at creation, pass or no pass", async () => {
      // The doc picked tee-off as the moment, and creation is the one place
      // a host writes their own ruleset — so a forged receipt would be one
      // POST away if this were allowed.
      await seedDayPass(host, 12 * HOUR);
      const { error } = await host.db
        .from("rounds")
        .insert({ name: "Forged", host: host.userId, ruleset: { members: true } });
      expectDenied(error);
    });

    it("lets an honest round be created either way", async () => {
      const { data, error } = await host.db
        .from("rounds")
        .insert({ name: "Honest", host: host.userId, ruleset: { format: "stroke" } })
        .select("id")
        .single();
      expect(error).toBeNull();
      if (data) {
        expect(await covered(data.id)).toBe(false);
        await adminClient().from("rounds").delete().eq("id", data.id);
      }
    });
  });

  describe("covered stays covered", () => {
    beforeEach(async () => {
      await seedDayPass(host, 12 * HOUR);
      await teeOff(host, round, { format: "stroke", members: true });
    });

    it("survives the pass running out mid-round", async () => {
      // The pass is the only thing that expires. This is the asymmetry the
      // whole design rests on: a slow crawl over the day boundary, or a
      // refund, can never change what a table already playing teed off
      // under.
      await adminClient()
        .from("entitlements")
        .update({ expires_at: new Date(Date.now() - HOUR).toISOString() })
        .eq("user_id", host.userId);

      const { error } = await host.db
        .from("rounds")
        .update({ current_hole: 2 })
        .eq("id", round.id);
      expect(error).toBeNull();
      expect(await covered(round.id)).toBe(true);
    });

    it("survives the pass being refunded out of existence", async () => {
      await adminClient()
        .from("entitlements")
        .delete()
        .eq("user_id", host.userId);
      const { error } = await host.db
        .from("rounds")
        .update({ status: "finished" })
        .eq("id", round.id);
      expect(error).toBeNull();
      expect(await covered(round.id)).toBe(true);
    });

    it("cannot be struck by an official", async () => {
      for (const actor of [host, caddy]) {
        const { error } = await actor.db
          .from("rounds")
          .update({ ruleset: { format: "stroke" } })
          .eq("id", round.id);
        expectDenied(error);
      }
      expect(await covered(round.id)).toBe(true);
    });

    it("cannot be struck by dropping the ruleset wholesale", async () => {
      const { error } = await host.db
        .from("rounds")
        .update({ ruleset: {} })
        .eq("id", round.id);
      expectDenied(error);
      expect(await covered(round.id)).toBe(true);
    });
  });

  describe("nobody else gets near it", () => {
    it("refuses a player and a guest outright", async () => {
      await seedDayPass(host, 12 * HOUR);
      for (const actor of [guest, stranger]) {
        // The rounds UPDATE policy admits officials only, so these are
        // filtered rather than raised — the stored row is the proof.
        await actor.db
          .from("rounds")
          .update({ ruleset: { members: true } })
          .eq("id", round.id);
      }
      expect(await covered(round.id)).toBe(false);
    });

    it("cannot be bought with somebody else's pass", async () => {
      // A stranger's live pass is not this round's host's.
      await seedDayPass(stranger, 12 * HOUR);
      const { error } = await teeOff(host, round, { members: true });
      expectDenied(error);
      expect(await covered(round.id)).toBe(false);
    });

    it("cannot be reached by forging the pass itself", async () => {
      // Belt and braces on 20260821: entitlements has no write policy at
      // all, so the shortest route to a forged pass is closed too.
      const { error } = await host.db.from("entitlements").insert({
        user_id: host.userId,
        kind: "green_fee",
        stripe_event_id: `evt_forged_${randomUUID()}`,
        expires_at: new Date(Date.now() + HOUR).toISOString(),
      });
      expectDenied(error);

      const { data: forged } = await host.db.rpc("holds_day_pass", {
        who: host.userId,
      });
      expect(forged).toBe(false);
    });

    it("cannot be extended by its own buyer", async () => {
      await seedDayPass(host, -HOUR);
      const { data: mine } = await host.db
        .from("entitlements")
        .select("id")
        .eq("user_id", host.userId);
      // Readable — it is their receipt — and not writable.
      expect(mine).toHaveLength(1);

      await host.db
        .from("entitlements")
        .update({ expires_at: new Date(Date.now() + 99 * HOUR).toISOString() })
        .eq("user_id", host.userId);

      const { data: still } = await host.db.rpc("holds_day_pass", {
        who: host.userId,
      });
      expect(still).toBe(false);
    });
  });
});
