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

/** A hole read past RLS — the only honest answer to "did that write land?". */
async function storedHole(roundId: string, number: number) {
  const { data, error } = await adminClient()
    .from("holes")
    .select("id, number, venue_id, venue_name, par, drink, walk_minutes_to_next")
    .eq("round_id", roundId)
    .eq("number", number)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Who may move a hole to a different pub.
 *
 * The round's holes are a snapshot, and until the pub could be swapped
 * mid-round nothing ever wrote to them after createRound — so the "officials
 * manage holes" policy had never been asked a question. It is asked here,
 * because swapHolePub is a UX guard and an attacker with the anon key goes
 * nowhere near a server action.
 *
 * The stakes are not vandalism so much as the record: the hole is where the
 * round says everyone drank, and a player who could rewrite it could rewrite
 * where their own swigs were earned.
 */
describe("holes", () => {
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
      status: "live",
      currentHole: 2,
    });
  });

  describe("the officials", () => {
    it("lets the host point a hole at another pub", async () => {
      const { error } = await host.db
        .from("holes")
        .update({ venue_name: "The Bear" })
        .eq("round_id", round.id)
        .eq("number", 2);
      expect(error).toBeNull();
      expect((await storedHole(round.id, 2)).venue_name).toBe("The Bear");
    });

    it("lets the caddy do it too — they are the one at the locked door", async () => {
      const { error } = await caddy.db
        .from("holes")
        .update({ venue_name: "The Bear" })
        .eq("round_id", round.id)
        .eq("number", 2);
      expect(error).toBeNull();
      expect((await storedHole(round.id, 2)).venue_name).toBe("The Bear");
    });

    it("lets a walk leg be re-measured with it", async () => {
      const { error } = await caddy.db
        .from("holes")
        .update({ walk_minutes_to_next: 14 })
        .eq("round_id", round.id)
        .eq("number", 1);
      expect(error).toBeNull();
      expect((await storedHole(round.id, 1)).walk_minutes_to_next).toBe(14);
    });

    it("leaves the hole's dressing where it was", async () => {
      const before = await storedHole(round.id, 2);
      await caddy.db
        .from("holes")
        .update({ venue_name: "The Bear", venue_id: null })
        .eq("round_id", round.id)
        .eq("number", 2);
      const after = await storedHole(round.id, 2);
      // Par and the drink belong to the hole, not to the pub — a swap that
      // moved them would rescore the round.
      expect(after.par).toBe(before.par);
      expect(after.drink).toBe(before.drink);
      expect(after.number).toBe(before.number);
      expect(after.id).toBe(before.id);
    });
  });

  describe("everyone else", () => {
    it("refuses a player moving the hole they are drinking on", async () => {
      const { error } = await player.db
        .from("holes")
        .update({ venue_name: "The Wetherspoons" })
        .eq("round_id", round.id)
        .eq("number", 2);
      // A filtered UPDATE is not an error — it matches no rows and reports
      // success. The stored row is the only proof.
      expect(error).toBeNull();
      expect((await storedHole(round.id, 2)).venue_name).not.toBe(
        "The Wetherspoons",
      );
    });

    it("refuses a player adding a hole to the round", async () => {
      const { error } = await player.db.from("holes").insert({
        round_id: round.id,
        number: 99,
        venue_name: "The Phantom",
        drink: "Pint",
        par: 1,
      });
      expectDenied(error);
    });

    it("refuses a player deleting a hole out from under the card", async () => {
      await player.db
        .from("holes")
        .delete()
        .eq("round_id", round.id)
        .eq("number", 2);
      const { count } = await adminClient()
        .from("holes")
        .select("id", { count: "exact", head: true })
        .eq("round_id", round.id);
      expect(count).toBe(round.holeCount);
    });

    it("refuses a stranger who is not in the round at all", async () => {
      const { error } = await stranger.db
        .from("holes")
        .update({ venue_name: "The Wetherspoons" })
        .eq("round_id", round.id)
        .eq("number", 2);
      expect(error).toBeNull();
      expect((await storedHole(round.id, 2)).venue_name).not.toBe(
        "The Wetherspoons",
      );
    });

    it("shows a signed-out visitor no holes to move in the first place", async () => {
      const anon = visitor();
      const { data } = await anon
        .from("holes")
        .select("id")
        .eq("round_id", round.id);
      expect(data ?? []).toHaveLength(0);
    });
  });
});
