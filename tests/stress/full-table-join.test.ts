import { beforeEach, describe, expect, it } from "vitest";

import { adminClient, anonymousGuest, signedInUser } from "@/tests/support/clients";
import type { Actor } from "@/tests/support/clients";
import { pooled } from "@/tests/support/concurrency";
import { seedRound } from "@/tests/support/factories";
import type { SeededRound } from "@/tests/support/factories";
import { FULL_TABLE, seatName } from "@/tests/support/table";

import { seatCount } from "../db/helpers/assert";

/**
 * Twenty phones on one join code, all at the same traffic light.
 *
 * `multiplayer-concurrency` proves the joining rules with four, which is the
 * shape of a foursome. This asks the question a stag do asks: the code goes
 * into the group chat, twenty people read it within a second of each other,
 * and every one of them taps Join at once. Nothing here goes through the
 * server action — `join_round` is a SECURITY DEFINER function reached on each
 * guest's own session, and that function is the entire door.
 *
 * Every assertion reads back through the admin client. Under a stampede the
 * response to any one request proves nothing about the row that survived.
 */

/** Mint N guests. Bounded on purpose — the sign-ins are setup, and the
 * stampede being measured is the join, which fires all at once below. */
function mintGuests(count: number): Promise<Actor[]> {
  return pooled(
    Array.from({ length: count }, (_, index) => index),
    8,
    (index) => anonymousGuest(seatName(index)),
  );
}

async function seatsOn(roundId: string) {
  const { data, error } = await adminClient()
    .from("round_players")
    .select("id, profile_id, display_name, role")
    .eq("round_id", roundId);
  if (error) throw error;
  return data;
}

describe("a stampede of twenty on one join code", () => {
  let host: Actor;
  let round: SeededRound;

  beforeEach(async () => {
    host = await signedInUser("Wren");
    round = await seedRound({ host, status: "lobby", holes: 18 });
  });

  it("seats nineteen strangers exactly once each, all at once", async () => {
    const guests = await mintGuests(FULL_TABLE - 1);

    // The stampede itself: no pool, no stagger. Nineteen calls in flight.
    const results = await Promise.all(
      guests.map((guest) =>
        guest.db.rpc("join_round", {
          join_code: round.code,
          player_name: guest.name,
        }),
      ),
    );
    for (const { error } of results) expect(error).toBeNull();

    const seats = await seatsOn(round.id);
    expect(seats).toHaveLength(FULL_TABLE);

    // One seat per person, and the right name on each — a stampede that
    // seated everyone twenty times, or wrote one name onto twenty cards,
    // would still pass a bare count.
    expect(new Set(seats.map((seat) => seat.profile_id)).size).toBe(FULL_TABLE);
    const nameByProfile = new Map(
      seats.map((seat) => [seat.profile_id, seat.display_name]),
    );
    for (const guest of guests) {
      expect(nameByProfile.get(guest.userId)).toBe(guest.name);
    }
    // Exactly one host, and the join door never hands out an official seat.
    expect(seats.filter((seat) => seat.role === "host")).toHaveLength(1);
    expect(seats.filter((seat) => seat.role !== "player")).toHaveLength(1);
  });

  it("holds at one seat each when the whole table double-taps", async () => {
    // Nineteen people, thirty-eight taps, no coordination: the join button on
    // a slow pub connection gets pressed twice as a matter of course. Both
    // calls hit ON CONFLICT DO NOTHING on the same (round_id, profile_id), so
    // the second blocks on the first and stands down.
    const guests = await mintGuests(FULL_TABLE - 1);

    const results = await Promise.all(
      guests.flatMap((guest) => [
        guest.db.rpc("join_round", {
          join_code: round.code,
          player_name: guest.name,
        }),
        guest.db.rpc("join_round", {
          join_code: round.code,
          player_name: guest.name,
        }),
      ]),
    );
    for (const { error } of results) expect(error).toBeNull();

    expect(await seatCount(round.id)).toBe(FULL_TABLE);
  });

  it("lets nineteen latecomers walk into a round already live", async () => {
    // The round teed off without them and `join_round` still takes them —
    // the same door, mid-play, under the same stampede.
    const { error: teeOff } = await adminClient()
      .from("rounds")
      .update({ status: "live", current_hole: 4 })
      .eq("id", round.id);
    expect(teeOff).toBeNull();

    const guests = await mintGuests(FULL_TABLE - 1);
    const results = await Promise.all(
      guests.map((guest) =>
        guest.db.rpc("join_round", {
          join_code: round.code,
          player_name: guest.name,
        }),
      ),
    );
    for (const { error } of results) expect(error).toBeNull();

    expect(await seatCount(round.id)).toBe(FULL_TABLE);
  });

  it("keeps the direct-insert door shut for all nineteen at once", async () => {
    // `join_round` is the only way in since the RLS hardening migration. A
    // stampede is exactly when a policy that only usually holds would show
    // it, so the whole table tries the door PostgREST exposes directly.
    const guests = await mintGuests(FULL_TABLE - 1);

    const results = await Promise.all(
      guests.map((guest) =>
        guest.db.from("round_players").insert({
          round_id: round.id,
          profile_id: guest.userId,
          display_name: guest.name,
          role: "player",
          handicap: 0,
        }),
      ),
    );
    for (const { error } of results) expect(error).not.toBeNull();

    // Read the row count back rather than trusting nineteen error objects:
    // the host's seat is the only one that was ever legitimate.
    expect(await seatCount(round.id)).toBe(1);
  });

  it("refuses a stampede at the wrong code without seating anybody", async () => {
    const guests = await mintGuests(FULL_TABLE - 1);
    const results = await Promise.all(
      guests.map((guest) =>
        guest.db.rpc("join_round", {
          join_code: "ZZZZZZ",
          player_name: guest.name,
        }),
      ),
    );
    for (const { error } of results) expect(error).not.toBeNull();
    expect(await seatCount(round.id)).toBe(1);
  });
});
