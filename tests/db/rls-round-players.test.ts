import { beforeEach, describe, expect, it } from "vitest";

import {
  anonymousGuest,
  signedInUser,
  visitor,
  type Actor,
} from "@/tests/support/clients";
import { seedRound, type SeededRound } from "@/tests/support/factories";

import { expectDenied, seatCount, storedSeat } from "./helpers/assert";

/**
 * Who may sit down at a round, and what they may become once seated.
 *
 * These run against the database directly rather than through the server
 * actions, which is the point: `getOfficiatedRound` in lib/actions/rounds.ts
 * calls itself a UX guard, and an attacker with the anon key and a session
 * never goes near it. RLS is the only thing actually standing here.
 */
describe("round_players", () => {
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
    });
  });

  describe("taking a seat", () => {
    it("refuses an outsider who seats themselves as host", async () => {
      // The escalation this policy exists to stop: knowing a round's uuid was
      // once enough to become an official in it.
      const { error } = await stranger.db.from("round_players").insert({
        round_id: round.id,
        profile_id: stranger.userId,
        display_name: "Stranger",
        role: "host",
      });
      expectDenied(error);
      expect(await seatCount(round.id)).toBe(3);
    });

    it("refuses an outsider who seats themselves as an ordinary player", async () => {
      // join_round is the way in, and it is the only path that requires
      // knowing the code.
      const { error } = await stranger.db.from("round_players").insert({
        round_id: round.id,
        profile_id: stranger.userId,
        display_name: "Stranger",
        role: "player",
      });
      expectDenied(error);
      expect(await seatCount(round.id)).toBe(3);
    });

    it("refuses a seat taken in someone else's name", async () => {
      const { error } = await stranger.db.from("round_players").insert({
        round_id: round.id,
        profile_id: host.userId,
        display_name: "Not me",
        role: "player",
      });
      expectDenied(error);
    });

    it("lets the creator take their own host seat", async () => {
      // createRound writes the round, then this row, then the holes — the
      // holes policy needs is_round_official, so the host has to be seated
      // first. If this breaks, hosting a round breaks.
      const { data: fresh, error: roundError } = await host.db
        .from("rounds")
        .insert({ name: "Hand-rolled", host: host.userId, ruleset: {} })
        .select("id")
        .single();
      expect(roundError).toBeNull();

      const { error } = await host.db.from("round_players").insert({
        round_id: fresh!.id,
        profile_id: host.userId,
        display_name: "Host",
        role: "host",
      });
      expect(error).toBeNull();
    });
  });

  describe("changing a role", () => {
    it("refuses a player promoting themselves to caddy", async () => {
      const { error } = await player.db
        .from("round_players")
        .update({ role: "caddy" })
        .eq("round_id", round.id)
        .eq("profile_id", player.userId);
      expectDenied(error);
      expect((await storedSeat(round.id, player.userId))?.role).toBe("player");
    });

    it("refuses a player promoting themselves straight to host", async () => {
      const { error } = await player.db
        .from("round_players")
        .update({ role: "host" })
        .eq("round_id", round.id)
        .eq("profile_id", player.userId);
      expectDenied(error);
      expect((await storedSeat(round.id, player.userId))?.role).toBe("player");
    });

    it("refuses a caddy demoting the host", async () => {
      // The host seat is fixed at creation. A filtered UPDATE reports no
      // error, so the stored row is the only honest witness.
      await caddy.db
        .from("round_players")
        .update({ role: "player" })
        .eq("round_id", round.id)
        .eq("profile_id", host.userId);
      expect((await storedSeat(round.id, host.userId))?.role).toBe("host");
    });

    it("refuses anyone minting a second host", async () => {
      await host.db
        .from("round_players")
        .update({ role: "host" })
        .eq("round_id", round.id)
        .eq("profile_id", player.userId);
      expect((await storedSeat(round.id, player.userId))?.role).toBe("player");
    });

    it("lets an official promote someone else to caddy", async () => {
      const { error } = await caddy.db
        .from("round_players")
        .update({ role: "caddy" })
        .eq("round_id", round.id)
        .eq("profile_id", player.userId);
      expect(error).toBeNull();
      expect((await storedSeat(round.id, player.userId))?.role).toBe("caddy");
    });

    it("lets a caddy stand back down", async () => {
      const { error } = await caddy.db
        .from("round_players")
        .update({ role: "player" })
        .eq("round_id", round.id)
        .eq("profile_id", caddy.userId);
      expect(error).toBeNull();
      expect((await storedSeat(round.id, caddy.userId))?.role).toBe("player");
    });
  });

  describe("the rest of the card", () => {
    it("lets a player rename their own card", async () => {
      const { error } = await player.db
        .from("round_players")
        .update({ display_name: "Renamed" })
        .eq("round_id", round.id)
        .eq("profile_id", player.userId);
      expect(error).toBeNull();
      expect((await storedSeat(round.id, player.userId))?.display_name).toBe(
        "Renamed",
      );
    });

    it("refuses a player renaming someone else's card", async () => {
      await player.db
        .from("round_players")
        .update({ display_name: "Vandalised" })
        .eq("round_id", round.id)
        .eq("profile_id", host.userId);
      expect((await storedSeat(round.id, host.userId))?.display_name).toBe(
        "Host",
      );
    });

    it("refuses a card being moved to another round", async () => {
      const elsewhere = await seedRound({ host: stranger });
      await player.db
        .from("round_players")
        .update({ round_id: elsewhere.id })
        .eq("round_id", round.id)
        .eq("profile_id", player.userId);
      expect((await storedSeat(round.id, player.userId))?.round_id).toBe(
        round.id,
      );
    });

    it("keeps a signed-out visitor out entirely", async () => {
      const { error } = await visitor().from("round_players").insert({
        round_id: round.id,
        profile_id: player.userId,
        display_name: "Nobody",
        role: "player",
      });
      expect(error).not.toBeNull();
    });

    it("gives nobody a way to leave a round", async () => {
      // There is no DELETE policy on round_players, by design — a card stays
      // on the scoreboard. Asserted so removing it is a decision.
      await player.db
        .from("round_players")
        .delete()
        .eq("round_id", round.id)
        .eq("profile_id", player.userId);
      expect(await seatCount(round.id)).toBe(3);
    });
  });
});
