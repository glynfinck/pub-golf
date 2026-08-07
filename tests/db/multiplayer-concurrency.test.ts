import { beforeEach, describe, expect, it } from "vitest";

import {
  adminClient,
  anonymousGuest,
  signedInUser,
  type Actor,
} from "@/tests/support/clients";
import { seedRound, type SeededRound } from "@/tests/support/factories";

import { seatCount, storedRound } from "./helpers/assert";

/**
 * A pub table is the worst concurrency environment there is: four thumbs,
 * one round, no coordination. These tests fire the writes a real table
 * fires — through PostgREST, each on its own session — at the same moment,
 * and ask what the database holds afterwards. Every assertion reads back
 * through the admin client: under concurrency, the response to any one
 * request proves nothing about the row that survived.
 */
describe("a full table, all at once", () => {
  describe("joining", () => {
    let host: Actor;
    let round: SeededRound;

    beforeEach(async () => {
      host = await signedInUser("Host");
      round = await seedRound({ host, status: "lobby" });
    });

    it("seats a stampede of guests exactly once each", async () => {
      const guests = await Promise.all([
        anonymousGuest("Ana"),
        anonymousGuest("Bram"),
        anonymousGuest("Cleo"),
        anonymousGuest("Dot"),
      ]);

      const results = await Promise.all(
        guests.map((guest) =>
          guest.db.rpc("join_round", {
            join_code: round.code,
            player_name: guest.name,
          }),
        ),
      );

      for (const { error } of results) expect(error).toBeNull();
      expect(await seatCount(round.id)).toBe(5);
    });

    it("keeps one seat when the same guest double-taps join", async () => {
      // The double-tap race: both calls hit ON CONFLICT DO NOTHING on the
      // same (round_id, profile_id), so the second blocks on the first's
      // insert and then quietly stands down — never an error, never a
      // second seat.
      const guest = await anonymousGuest("Ana");
      const results = await Promise.all([
        guest.db.rpc("join_round", {
          join_code: round.code,
          player_name: "Ana",
        }),
        guest.db.rpc("join_round", {
          join_code: round.code,
          player_name: "Ana",
        }),
      ]);

      for (const { error } of results) expect(error).toBeNull();
      expect(await seatCount(round.id)).toBe(2);
    });
  });

  describe("scoring", () => {
    let host: Actor;
    let caddy: Actor;
    let ana: Actor;
    let bram: Actor;
    let round: SeededRound;

    beforeEach(async () => {
      [host, caddy, ana, bram] = await Promise.all([
        signedInUser("Host"),
        anonymousGuest("Caddy"),
        anonymousGuest("Ana"),
        anonymousGuest("Bram"),
      ]);
      round = await seedRound({
        host,
        players: [
          { ...caddy, role: "caddy" },
          { ...ana, role: "player" },
          { ...bram, role: "player" },
        ],
      });
    });

    /** The write upsertScore sends, on the caller's own session. */
    function fileSwigs(actor: Actor, seatOf: Actor, swigs: number) {
      return actor.db.from("scores").upsert(
        {
          round_id: round.id,
          player_id: round.seatOf[seatOf.userId],
          hole_number: 1,
          swigs,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "player_id,hole_number" },
      );
    }

    async function storedHole(holeNumber: number) {
      const { data, error } = await adminClient()
        .from("scores")
        .select("player_id, swigs")
        .eq("round_id", round.id)
        .eq("hole_number", holeNumber);
      if (error) throw error;
      return data;
    }

    it("lands one score per player when the whole group files at once", async () => {
      const results = await Promise.all([
        fileSwigs(host, host, 2),
        fileSwigs(ana, ana, 3),
        fileSwigs(bram, bram, 4),
      ]);
      for (const { error } of results) expect(error).toBeNull();

      const rows = await storedHole(1);
      expect(rows).toHaveLength(3);
      const byPlayer = Object.fromEntries(
        rows.map((row) => [row.player_id, row.swigs]),
      );
      expect(byPlayer[round.seatOf[host.userId]]).toBe(2);
      expect(byPlayer[round.seatOf[ana.userId]]).toBe(3);
      expect(byPlayer[round.seatOf[bram.userId]]).toBe(4);
    });

    it("keeps one row when a player races their own debounce", async () => {
      // The play screen debounces taps into one upsert, but a mulligan or
      // a slow network can put two in flight together. Whichever lands
      // second must update, not duplicate.
      const results = await Promise.all([
        fileSwigs(ana, ana, 3),
        fileSwigs(ana, ana, 5),
      ]);
      for (const { error } of results) expect(error).toBeNull();

      const rows = await storedHole(1);
      expect(rows).toHaveLength(1);
      expect([3, 5]).toContain(rows[0].swigs);
    });

    it("keeps one row when the marker and the player collide", async () => {
      // The caddy corrects Ana's card at the same moment Ana's own debounce
      // fires — the exact race the marker's card creates on every edit.
      const results = await Promise.all([
        fileSwigs(caddy, ana, 6),
        fileSwigs(ana, ana, 2),
      ]);
      for (const { error } of results) expect(error).toBeNull();

      const rows = await storedHole(1);
      expect(rows).toHaveLength(1);
      expect([2, 6]).toContain(rows[0].swigs);
    });

    it("attributes simultaneous penalties to their callers", async () => {
      const callers = [host, ana, bram];
      const results = await Promise.all(
        callers.map((actor) =>
          actor.db.from("penalties").insert({
            round_id: round.id,
            player_id: round.seatOf[actor.userId],
            hole_number: 1,
            strokes: 1,
            reason: "Spilling your own drink",
            called_by: round.seatOf[actor.userId],
          }),
        ),
      );
      for (const { error } of results) expect(error).toBeNull();

      const { data, error } = await adminClient()
        .from("penalties")
        .select("player_id, called_by")
        .eq("round_id", round.id);
      if (error) throw error;
      expect(data).toHaveLength(3);
      // Nobody's penalty ended up on anybody else's card in the scramble.
      for (const row of data) expect(row.called_by).toBe(row.player_id);
    });

    it("advances once when both officials call the hole together", async () => {
      // advanceHole writes an explicit target hole, never an increment — so
      // the host and the caddy calling it in the same instant converge on
      // the same hole instead of skipping one.
      const results = await Promise.all([
        host.db
          .from("rounds")
          .update({ current_hole: 2 })
          .eq("id", round.id),
        caddy.db
          .from("rounds")
          .update({ current_hole: 2 })
          .eq("id", round.id),
      ]);
      for (const { error } of results) expect(error).toBeNull();

      expect((await storedRound(round.id)).current_hole).toBe(2);
    });
  });
});
