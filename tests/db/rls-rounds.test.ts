import { beforeEach, describe, expect, it } from "vitest";

import {
  adminClient,
  anonymousGuest,
  signedInUser,
  visitor,
  type Actor,
} from "@/tests/support/clients";
import {
  seedRound,
  seedScores,
  type SeededRound,
} from "@/tests/support/factories";

import { roundExists, seatCount, storedRound } from "./helpers/assert";

/**
 * Officials run a round; they do not own it. Everything the caddy controls
 * actually touch stays open, and the round's identity does not.
 */
describe("rounds", () => {
  let host: Actor;
  let caddy: Actor;
  let player: Actor;
  let stranger: Actor;
  let round: SeededRound;

  beforeEach(async () => {
    [host, caddy, player, stranger] = await Promise.all([
      signedInUser("Host"),
      anonymousGuest("Caddy"),
      anonymousGuest("Player"),
      signedInUser("Stranger"),
    ]);
    round = await seedRound({
      host,
      players: [
        { ...caddy, role: "caddy" },
        { ...player, role: "player" },
      ],
      status: "lobby",
    });
  });

  describe("reading", () => {
    it("is visible to everyone seated", async () => {
      for (const actor of [host, caddy, player]) {
        const { data } = await actor.db
          .from("rounds")
          .select("id")
          .eq("id", round.id)
          .maybeSingle();
        expect(data?.id).toBe(round.id);
      }
    });

    it("is invisible to someone who is not in it", async () => {
      const { data } = await stranger.db
        .from("rounds")
        .select("id")
        .eq("id", round.id)
        .maybeSingle();
      expect(data).toBeNull();
    });

    it("is invisible to a signed-out visitor", async () => {
      const { data } = await visitor()
        .from("rounds")
        .select("id")
        .eq("id", round.id)
        .maybeSingle();
      expect(data ?? null).toBeNull();
    });
  });

  describe("running the round", () => {
    it("lets an official tee off and advance", async () => {
      const { error } = await caddy.db
        .from("rounds")
        .update({ status: "live", current_hole: 2, hole_phase: "walking" })
        .eq("id", round.id);
      expect(error).toBeNull();

      const stored = await storedRound(round.id);
      expect(stored).toMatchObject({
        status: "live",
        current_hole: 2,
        hole_phase: "walking",
      });
    });

    it("refuses an ordinary player advancing the round", async () => {
      // A filtered UPDATE is silent, so the stored row is the witness.
      await player.db
        .from("rounds")
        .update({ current_hole: 9 })
        .eq("id", round.id);
      expect((await storedRound(round.id)).current_hole).toBe(1);
    });

    it("refuses an outsider advancing the round", async () => {
      await stranger.db
        .from("rounds")
        .update({ current_hole: 9 })
        .eq("id", round.id);
      expect((await storedRound(round.id)).current_hole).toBe(1);
    });
  });

  describe("the round's identity", () => {
    it("refuses a caddy rewriting the join code", async () => {
      // The code is the route key every phone in the group is holding.
      const before = (await storedRound(round.id)).code;
      await caddy.db
        .from("rounds")
        .update({ code: "HIJACK" })
        .eq("id", round.id);
      expect((await storedRound(round.id)).code).toBe(before);
    });

    it("refuses a caddy taking ownership", async () => {
      await caddy.db
        .from("rounds")
        .update({ host: caddy.userId })
        .eq("id", round.id);
      expect((await storedRound(round.id)).host).toBe(host.userId);
    });

    it("refuses even the host handing the round over", async () => {
      // Nothing in the app does this, and the host seat is fixed at creation,
      // so a round changing hands would strand its own host row.
      await host.db
        .from("rounds")
        .update({ host: stranger.userId })
        .eq("id", round.id);
      expect((await storedRound(round.id)).host).toBe(host.userId);
    });
  });

  describe("creating", () => {
    it("lets a signed-in user open a round in their own name", async () => {
      const { data, error } = await host.db
        .from("rounds")
        .insert({ name: "Mine", host: host.userId, ruleset: {} })
        .select("id, code")
        .single();
      expect(error).toBeNull();
      expect(data?.code).toMatch(/^[A-Z2-9]{6}$/);
    });

    it("refuses a round opened in someone else's name", async () => {
      const { error } = await stranger.db
        .from("rounds")
        .insert({ name: "Not mine", host: host.userId, ruleset: {} });
      expect(error).not.toBeNull();
    });

  });

  describe("deleting", () => {
    // Rounds had no DELETE policy at all until the host management
    // migration — "hosts delete rounds" is a deliberate decision, and this
    // suite is where its edges are pinned.

    it("lets the host tear up their own round, card and all", async () => {
      await seedScores(round.id, [
        { playerId: round.seatOf[player.userId], hole: 1, swigs: 3 },
      ]);

      const { error } = await host.db
        .from("rounds")
        .delete()
        .eq("id", round.id);
      expect(error).toBeNull();
      expect(await roundExists(round.id)).toBe(false);

      // The cascades take the whole card with the round.
      expect(await seatCount(round.id)).toBe(0);
      const { count: holesLeft } = await adminClient()
        .from("holes")
        .select("id", { count: "exact", head: true })
        .eq("round_id", round.id);
      expect(holesLeft ?? 0).toBe(0);
      const { count: scoresLeft } = await adminClient()
        .from("scores")
        .select("id", { count: "exact", head: true })
        .eq("round_id", round.id);
      expect(scoresLeft ?? 0).toBe(0);
    });

    it("refuses the caddy — officiating is not ownership", async () => {
      // A filtered DELETE is as silent as a filtered UPDATE: no error, no
      // rows. The surviving round is the only honest witness.
      await caddy.db.from("rounds").delete().eq("id", round.id);
      expect(await roundExists(round.id)).toBe(true);
    });

    it("refuses an ordinary player", async () => {
      await player.db.from("rounds").delete().eq("id", round.id);
      expect(await roundExists(round.id)).toBe(true);
    });

    it("refuses an outsider", async () => {
      await stranger.db.from("rounds").delete().eq("id", round.id);
      expect(await roundExists(round.id)).toBe(true);
    });
  });
});
