import { beforeEach, describe, expect, it } from "vitest";

import {
  adminClient,
  anonymousGuest,
  signedInUser,
  type Actor,
} from "@/tests/support/clients";
import {
  seedRound,
  seedScores,
  type SeededRound,
} from "@/tests/support/factories";

import { expectDenied } from "./helpers/assert";

/**
 * The adversarial pass: a player with nothing but their own session, trying
 * to win. Every attack here is something the phone's own controls will never
 * offer — which is exactly why it has to be the database that refuses it,
 * not the UI. A blocked write is proven by reading the row back with the
 * admin key, never by the attacker's own response.
 */
describe("cheating the card", () => {
  let host: Actor;
  let caddy: Actor;
  let player: Actor;
  let round: SeededRound;

  /** The player's seat id — the card every attack tries to flatter. */
  const seat = () => round.seatOf[player.userId];

  async function storedScore(hole: number) {
    const { data, error } = await adminClient()
      .from("scores")
      .select("swigs, mulligans")
      .eq("player_id", seat())
      .eq("hole_number", hole)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  beforeEach(async () => {
    [host, caddy, player] = await Promise.all([
      signedInUser("Host"),
      anonymousGuest("Caddy"),
      anonymousGuest("Player"),
    ]);
    // Live on hole 2 of 3: hole 1 is filed, hole 3 is tomorrow's.
    round = await seedRound({
      host,
      players: [
        { ...caddy, role: "caddy" },
        { ...player, role: "player" },
      ],
      holes: 3,
      currentHole: 2,
      mulligans: 2,
    });
  });

  describe("the hole window", () => {
    it("refuses to book tomorrow's holes with cheap swigs", async () => {
      const { error } = await player.db.from("scores").insert({
        round_id: round.id,
        player_id: seat(),
        hole_number: 3,
        swigs: 1,
      });
      expectDenied(error);
      expect(await storedScore(3)).toBeNull();
    });

    it("refuses to talk a filed hole down", async () => {
      await seedScores(round.id, [{ playerId: seat(), hole: 1, swigs: 6 }]);
      await player.db
        .from("scores")
        .update({ swigs: 2 })
        .eq("player_id", seat())
        .eq("hole_number", 1);
      // An UPDATE the trigger rejects errors loudly; assert on the row, the
      // only witness that cannot be argued with.
      expect((await storedScore(1))?.swigs).toBe(6);
    });

    it("lets a player own up to a missed swig on a filed hole", async () => {
      await seedScores(round.id, [{ playerId: seat(), hole: 1, swigs: 6 }]);
      const { error } = await player.db
        .from("scores")
        .update({ swigs: 7 })
        .eq("player_id", seat())
        .eq("hole_number", 1);
      expect(error).toBeNull();
      expect((await storedScore(1))?.swigs).toBe(7);
    });

    it("refuses a first-ever score against a hole the substitute filed", async () => {
      // No row on hole 1, so the substitute scored it at par. A late "1"
      // would undercut that — the whole point of the substitute rule.
      const { error } = await player.db.from("scores").insert({
        round_id: round.id,
        player_id: seat(),
        hole_number: 1,
        swigs: 1,
      });
      expectDenied(error);
      expect(await storedScore(1)).toBeNull();
    });

    it("still lets the live hole move both ways — the undo button", async () => {
      await seedScores(round.id, [{ playerId: seat(), hole: 2, swigs: 4 }]);
      const { error } = await player.db
        .from("scores")
        .update({ swigs: 3 })
        .eq("player_id", seat())
        .eq("hole_number", 2);
      expect(error).toBeNull();
      expect((await storedScore(2))?.swigs).toBe(3);
    });

    it("freezes the last hole downward once the card is filed", async () => {
      const finished = await seedRound({
        host,
        players: [{ ...player, role: "player" }],
        holes: 3,
        currentHole: 3,
        status: "finished",
      });
      await seedScores(finished.id, [
        { playerId: finished.seatOf[player.userId], hole: 3, swigs: 5 },
      ]);
      await player.db
        .from("scores")
        .update({ swigs: 1 })
        .eq("player_id", finished.seatOf[player.userId])
        .eq("hole_number", 3);
      const { data } = await adminClient()
        .from("scores")
        .select("swigs")
        .eq("player_id", finished.seatOf[player.userId])
        .eq("hole_number", 3)
        .single();
      expect(data?.swigs).toBe(5);
    });

    it("lets the marker roam every hole in every direction", async () => {
      await seedScores(round.id, [{ playerId: seat(), hole: 1, swigs: 6 }]);
      // Lower a filed hole, and pre-open the next — both marker's-card moves.
      const lowered = await caddy.db
        .from("scores")
        .update({ swigs: 2 })
        .eq("player_id", seat())
        .eq("hole_number", 1);
      expect(lowered.error).toBeNull();
      const prefill = await caddy.db.from("scores").insert({
        round_id: round.id,
        player_id: seat(),
        hole_number: 3,
        swigs: 4,
      });
      expect(prefill.error).toBeNull();
      expect((await storedScore(1))?.swigs).toBe(2);
      expect((await storedScore(3))?.swigs).toBe(4);
    });
  });

  describe("mulligans", () => {
    it("refuses a player deleting the stroke their mulligan cost", async () => {
      await seedScores(round.id, [
        { playerId: seat(), hole: 2, swigs: 0, mulligans: 1 },
      ]);
      await player.db
        .from("scores")
        .update({ mulligans: 0 })
        .eq("player_id", seat())
        .eq("hole_number", 2);
      expect((await storedScore(2))?.mulligans).toBe(1);
    });

    it("lets the marker take one back off", async () => {
      await seedScores(round.id, [
        { playerId: seat(), hole: 2, swigs: 0, mulligans: 1 },
      ]);
      const { error } = await caddy.db
        .from("scores")
        .update({ mulligans: 0 })
        .eq("player_id", seat())
        .eq("hole_number", 2);
      expect(error).toBeNull();
      expect((await storedScore(2))?.mulligans).toBe(0);
    });
  });

  describe("the record", () => {
    it("gives nobody a way to delete a score row out of it", async () => {
      await seedScores(round.id, [{ playerId: seat(), hole: 1, swigs: 8 }]);
      // No DELETE policy exists, so this returns no error and no rows —
      // the silent kind of refusal only a re-read can prove.
      const { error } = await player.db
        .from("scores")
        .delete()
        .eq("player_id", seat())
        .eq("hole_number", 1);
      expect(error).toBeNull();
      expect((await storedScore(1))?.swigs).toBe(8);
    });
  });

  describe("penalties", () => {
    function callOn(actor: Actor, target: string, strokes: number) {
      return actor.db.from("penalties").insert({
        round_id: round.id,
        player_id: target,
        hole_number: 2,
        strokes,
        reason: "Spilling your own drink",
        called_by: round.seatOf[actor.userId],
      });
    }

    it("refuses negative strokes — the -20 that wins from the toilet", async () => {
      const { error } = await callOn(player, seat(), -20);
      // A check constraint, not a policy: 23514, refused before RLS is
      // even asked.
      expect(error?.code).toBe("23514");
    });

    it("bounds strokes to the house range either side", async () => {
      expect((await callOn(player, seat(), 0)).error?.code).toBe("23514");
      expect((await callOn(player, seat(), 21)).error?.code).toBe("23514");
      expect((await callOn(player, seat(), 20)).error).toBeNull();
    });

    it("refuses a player retracting the marker's call on them", async () => {
      await callOn(caddy, seat(), 5);
      const { error } = await player.db
        .from("penalties")
        .delete()
        .eq("player_id", seat());
      // Filtered, not raised — the policy now follows called_by.
      expect(error).toBeNull();
      const { count } = await adminClient()
        .from("penalties")
        .select("id", { count: "exact", head: true })
        .eq("player_id", seat());
      expect(count).toBe(1);
    });

    it("still lets a mis-tap of your own come back off", async () => {
      await callOn(player, seat(), 1);
      const { error } = await player.db
        .from("penalties")
        .delete()
        .eq("player_id", seat());
      expect(error).toBeNull();
      const { count } = await adminClient()
        .from("penalties")
        .select("id", { count: "exact", head: true })
        .eq("player_id", seat());
      expect(count).toBe(0);
    });
  });
});
