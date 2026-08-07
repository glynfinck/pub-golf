import { beforeEach, describe, expect, it } from "vitest";

import {
  anonymousGuest,
  signedInUser,
  visitor,
  type Actor,
} from "@/tests/support/clients";
import { seedRound, type SeededRound } from "@/tests/support/factories";

import { expectDenied, storedSeat } from "./helpers/assert";

/**
 * Who sets a handicap.
 *
 * A handicap is strokes off your own score, so "the player it flatters" is
 * exactly the wrong person to hold the pen. That rule cannot live in a policy:
 * the two UPDATE policies on round_players are "your own card" and "officials
 * update anyone but the host", and a player editing their own handicap sails
 * through the first. Only the trigger can ask which column moved.
 *
 * These drive Postgres directly rather than the server actions, because
 * setPlayerHandicap calls itself a UX guard and an attacker with the anon key
 * never goes near it.
 */
describe("handicaps", () => {
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

  it("starts every card off scratch", async () => {
    const seat = await storedSeat(round.id, player.userId);
    expect(seat?.handicap).toBe(0);
  });

  describe("the officials", () => {
    it("lets the host set a player's handicap", async () => {
      const { error } = await host.db
        .from("round_players")
        .update({ handicap: 6 })
        .eq("id", round.seatOf[player.userId]);
      expect(error).toBeNull();

      const seat = await storedSeat(round.id, player.userId);
      expect(seat?.handicap).toBe(6);
    });

    it("lets a caddy set one too — the caddy has the final word", async () => {
      const { error } = await caddy.db
        .from("round_players")
        .update({ handicap: 4 })
        .eq("id", round.seatOf[player.userId]);
      expect(error).toBeNull();

      const seat = await storedSeat(round.id, player.userId);
      expect(seat?.handicap).toBe(4);
    });

    it("lets the host set their own", async () => {
      // The non-obvious path: "officials update players" carries
      // `role <> 'host'` in USING, so the host's own row is reachable only
      // through the self policy — and the trigger has to let that through.
      const { error } = await host.db
        .from("round_players")
        .update({ handicap: 3 })
        .eq("id", round.seatOf[host.userId]);
      expect(error).toBeNull();

      const seat = await storedSeat(round.id, host.userId);
      expect(seat?.handicap).toBe(3);
    });

    it("lets an official change one after the round has teed off", async () => {
      // Players can join a live round, so a lobby-only rule would leave them
      // stuck on scratch with no way to be given their shots.
      const live = await seedRound({
        host,
        players: [{ ...player, role: "player" }],
        status: "live",
      });
      const { error } = await host.db
        .from("round_players")
        .update({ handicap: 8 })
        .eq("id", live.seatOf[player.userId]);
      expect(error).toBeNull();

      const seat = await storedSeat(live.id, player.userId);
      expect(seat?.handicap).toBe(8);
    });
  });

  describe("everyone else", () => {
    it("refuses a player awarding themselves shots", async () => {
      const { error } = await player.db
        .from("round_players")
        .update({ handicap: 20 })
        .eq("id", round.seatOf[player.userId]);
      expectDenied(error);

      // The trigger raises, so this one does error — but the row is still the
      // only honest witness.
      const seat = await storedSeat(round.id, player.userId);
      expect(seat?.handicap).toBe(0);
    });

    it("refuses a player handing shots to someone else", async () => {
      await player.db
        .from("round_players")
        .update({ handicap: 20 })
        .eq("id", round.seatOf[caddy.userId]);

      // No error here: the policy filters the row out rather than refusing,
      // so the write reports success and touches nothing.
      const seat = await storedSeat(round.id, caddy.userId);
      expect(seat?.handicap).toBe(0);
    });

    it("refuses an outsider entirely", async () => {
      await stranger.db
        .from("round_players")
        .update({ handicap: 30 })
        .eq("id", round.seatOf[player.userId]);

      const seat = await storedSeat(round.id, player.userId);
      expect(seat?.handicap).toBe(0);
    });

    it("refuses a signed-out visitor", async () => {
      await visitor()
        .from("round_players")
        .update({ handicap: 30 })
        .eq("id", round.seatOf[player.userId]);

      const seat = await storedSeat(round.id, player.userId);
      expect(seat?.handicap).toBe(0);
    });

    it("still lets a player rename their own card", async () => {
      // The trigger must pin down the handicap without freezing the row —
      // your own name on your own card stays yours.
      const { error } = await player.db
        .from("round_players")
        .update({ display_name: "Jamie again" })
        .eq("id", round.seatOf[player.userId]);
      expect(error).toBeNull();

      const seat = await storedSeat(round.id, player.userId);
      expect(seat?.display_name).toBe("Jamie again");
    });

    it("refuses a player smuggling a handicap in beside their name", async () => {
      const { error } = await player.db
        .from("round_players")
        .update({ display_name: "Jamie", handicap: 12 })
        .eq("id", round.seatOf[player.userId]);
      expectDenied(error);

      const seat = await storedSeat(round.id, player.userId);
      expect(seat?.handicap).toBe(0);
      expect(seat?.display_name).toBe("Player");
    });
  });

  it("refuses a handicap outside golf's own ceiling", async () => {
    for (const handicap of [-1, 55]) {
      const { error } = await host.db
        .from("round_players")
        .update({ handicap })
        .eq("id", round.seatOf[player.userId]);
      expect(error).not.toBeNull();
    }

    const seat = await storedSeat(round.id, player.userId);
    expect(seat?.handicap).toBe(0);
  });
});
