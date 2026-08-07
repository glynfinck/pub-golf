import { beforeEach, describe, expect, it } from "vitest";

import {
  adminClient,
  anonymousGuest,
  signedInUser,
  type Actor,
} from "@/tests/support/clients";
import { seedRound, type SeededRound } from "@/tests/support/factories";

import { expectDenied } from "./helpers/assert";

describe("scores and penalties", () => {
  let host: Actor;
  let caddy: Actor;
  let player: Actor;
  let stranger: Actor;
  let round: SeededRound;
  let elsewhere: SeededRound;

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
    elsewhere = await seedRound({ host: stranger });
  });

  describe("writing a score", () => {
    it("lets a player record their own swigs", async () => {
      const { error } = await player.db.from("scores").insert({
        round_id: round.id,
        player_id: round.seatOf[player.userId],
        hole_number: 1,
        swigs: 4,
      });
      expect(error).toBeNull();
    });

    it("refuses a player writing on someone else's card", async () => {
      const { error } = await player.db.from("scores").insert({
        round_id: round.id,
        player_id: round.seatOf[host.userId],
        hole_number: 1,
        swigs: 99,
      });
      expectDenied(error);
    });

    it("lets the marker write on anyone's card", async () => {
      const { error } = await caddy.db.from("scores").insert({
        round_id: round.id,
        player_id: round.seatOf[player.userId],
        hole_number: 1,
        swigs: 3,
      });
      expect(error).toBeNull();
    });

    it("refuses an outsider writing anything", async () => {
      const { error } = await stranger.db.from("scores").insert({
        round_id: round.id,
        player_id: round.seatOf[player.userId],
        hole_number: 1,
        swigs: 1,
      });
      expectDenied(error);
    });

    it("refuses a score filed against a player in another round", async () => {
      // scores.round_id is denormalised. Before it was tied to the player's
      // real round, an official of one round could file rows against a player
      // in another — rows that round's own officials could neither see nor
      // retract.
      const { error } = await stranger.db.from("scores").insert({
        round_id: elsewhere.id,
        player_id: round.seatOf[player.userId],
        hole_number: 1,
        swigs: 99,
      });
      expectDenied(error);
    });

    it("refuses a negative swig count", async () => {
      const { error } = await player.db.from("scores").insert({
        round_id: round.id,
        player_id: round.seatOf[player.userId],
        hole_number: 1,
        swigs: -1,
      });
      expect(error).not.toBeNull();
    });

    it("keeps one score per player per hole", async () => {
      // The unique constraint upsertScore's onConflict target relies on.
      await player.db.from("scores").insert({
        round_id: round.id,
        player_id: round.seatOf[player.userId],
        hole_number: 1,
        swigs: 2,
      });
      const { error } = await player.db.from("scores").insert({
        round_id: round.id,
        player_id: round.seatOf[player.userId],
        hole_number: 1,
        swigs: 5,
      });
      expect(error?.code).toBe("23505");
    });
  });

  describe("calling a penalty", () => {
    it("lets a player call one on themselves", async () => {
      const { error } = await player.db.from("penalties").insert({
        round_id: round.id,
        player_id: round.seatOf[player.userId],
        hole_number: 1,
        strokes: 2,
        reason: "Spilling your own drink",
        called_by: round.seatOf[player.userId],
      });
      expect(error).toBeNull();
    });

    it("refuses a player calling one on somebody else", async () => {
      const { error } = await player.db.from("penalties").insert({
        round_id: round.id,
        player_id: round.seatOf[host.userId],
        hole_number: 1,
        strokes: 5,
        reason: "Invented",
        called_by: round.seatOf[player.userId],
      });
      expectDenied(error);
    });

    it("lets the marker call one on anyone", async () => {
      const { error } = await caddy.db.from("penalties").insert({
        round_id: round.id,
        player_id: round.seatOf[player.userId],
        hole_number: 1,
        strokes: 3,
        reason: "Out of bounds — falling over, or off a stool",
        called_by: round.seatOf[caddy.userId],
      });
      expect(error).toBeNull();
    });

    it("refuses one filed against a player in another round", async () => {
      const { error } = await stranger.db.from("penalties").insert({
        round_id: elsewhere.id,
        player_id: round.seatOf[player.userId],
        hole_number: 1,
        strokes: 20,
        reason: "Cross-round",
        called_by: elsewhere.seatOf[stranger.userId],
      });
      expectDenied(error);
    });

    it("lets a player retract a penalty called on them", async () => {
      // Documented as open: the delete policy keys on who the penalty is
      // against, not who called it, so an official's call can be retracted by
      // its subject. The app's undo depends on this.
      const { data } = await adminClient()
        .from("penalties")
        .insert({
          round_id: round.id,
          player_id: round.seatOf[player.userId],
          hole_number: 1,
          strokes: 2,
          reason: "Called by the marker",
          called_by: round.seatOf[caddy.userId],
        })
        .select("id")
        .single();

      const { error } = await player.db
        .from("penalties")
        .delete()
        .eq("id", data!.id);
      expect(error).toBeNull();

      const { count } = await adminClient()
        .from("penalties")
        .select("id", { count: "exact", head: true })
        .eq("id", data!.id);
      expect(count).toBe(0);
    });
  });

  describe("reading", () => {
    it("shows the card to everyone in the round and nobody else", async () => {
      await adminClient().from("scores").insert({
        round_id: round.id,
        player_id: round.seatOf[player.userId],
        hole_number: 1,
        swigs: 4,
      });

      for (const actor of [host, caddy, player]) {
        const { count } = await actor.db
          .from("scores")
          .select("id", { count: "exact", head: true })
          .eq("round_id", round.id);
        expect(count).toBe(1);
      }

      const { count: leaked } = await stranger.db
        .from("scores")
        .select("id", { count: "exact", head: true })
        .eq("round_id", round.id);
      expect(leaked).toBe(0);
    });
  });
});

/**
 * The mulligan allowance.
 *
 * "At most N across the whole round" is a statement about sibling rows, which
 * WITH CHECK can never see — so a trigger holds it, and this is where that
 * trigger is actually proven. The server action's check is only the friendly
 * message.
 */
describe("mulligans", () => {
  let host: Actor;
  let player: Actor;
  let round: SeededRound;

  /** What the card really says, read past RLS. */
  async function storedBalls(playerId: string): Promise<number> {
    const { data } = await adminClient()
      .from("scores")
      .select("mulligans")
      .eq("player_id", playerId);
    return (data ?? []).reduce((sum, row) => sum + row.mulligans, 0);
  }

  beforeEach(async () => {
    [host, player] = await Promise.all([
      signedInUser("Host"),
      anonymousGuest("Player"),
    ]);
    round = await seedRound({
      host,
      players: [{ ...player, role: "player" }],
      mulligans: 2,
    });
  });

  it("starts every hole with none taken", async () => {
    await player.db.from("scores").insert({
      round_id: round.id,
      player_id: round.seatOf[player.userId],
      hole_number: 1,
      swigs: 3,
    });
    expect(await storedBalls(round.seatOf[player.userId])).toBe(0);
  });

  it("lets a player take one, and take the last one", async () => {
    const seat = round.seatOf[player.userId];
    for (const hole of [1, 2]) {
      const { error } = await player.db.from("scores").insert({
        round_id: round.id,
        player_id: seat,
        hole_number: hole,
        swigs: 0,
        mulligans: 1,
      });
      expect(error).toBeNull();
    }
    expect(await storedBalls(seat)).toBe(2);
  });

  it("refuses the one that would go over the allowance", async () => {
    const seat = round.seatOf[player.userId];
    await player.db.from("scores").insert([
      { round_id: round.id, player_id: seat, hole_number: 1, mulligans: 1 },
      { round_id: round.id, player_id: seat, hole_number: 2, mulligans: 1 },
    ]);

    const { error } = await player.db.from("scores").insert({
      round_id: round.id,
      player_id: seat,
      hole_number: 3,
      mulligans: 1,
    });
    expectDenied(error);
    expect(await storedBalls(seat)).toBe(2);
  });

  it("counts the whole round, not one hole at a time", async () => {
    // Three on a single hole is the same overdraft as one on each of three.
    const seat = round.seatOf[player.userId];
    const { error } = await player.db.from("scores").insert({
      round_id: round.id,
      player_id: seat,
      hole_number: 1,
      mulligans: 3,
    });
    expectDenied(error);
    expect(await storedBalls(seat)).toBe(0);
  });

  it("refuses an update that raises the count past the allowance", async () => {
    const seat = round.seatOf[player.userId];
    await player.db.from("scores").insert({
      round_id: round.id,
      player_id: seat,
      hole_number: 1,
      mulligans: 2,
    });

    const { error } = await player.db
      .from("scores")
      .update({ mulligans: 3 })
      .eq("player_id", seat)
      .eq("hole_number", 1);
    expectDenied(error);
    expect(await storedBalls(seat)).toBe(2);
  });

  it("always lets one come back off the card", async () => {
    // Officials correct mistakes downwards; that can never be an overdraft.
    const seat = round.seatOf[player.userId];
    await player.db.from("scores").insert({
      round_id: round.id,
      player_id: seat,
      hole_number: 1,
      mulligans: 2,
    });

    const { error } = await host.db
      .from("scores")
      .update({ mulligans: 1 })
      .eq("player_id", seat)
      .eq("hole_number", 1);
    expect(error).toBeNull();
    expect(await storedBalls(seat)).toBe(1);
  });

  it("gives a round that predates the rule an allowance of none", async () => {
    const legacy = await seedRound({
      host,
      players: [{ ...player, role: "player" }],
      legacyRuleset: true,
    });
    const seat = legacy.seatOf[player.userId];

    const { error } = await player.db.from("scores").insert({
      round_id: legacy.id,
      player_id: seat,
      hole_number: 1,
      mulligans: 1,
    });
    expectDenied(error);
    expect(await storedBalls(seat)).toBe(0);
  });

  it("leaves one on the card when a swig lands on the same hole", async () => {
    // upsertScore writes swigs without naming mulligans. PostgREST
    // builds its `on conflict do update set` list from the body's keys, so an
    // omitted column should survive — but a swig tap quietly wiping somebody's
    // half pint is exactly the bug nobody would report, so it gets pinned.
    const seat = round.seatOf[player.userId];
    await player.db.from("scores").insert({
      round_id: round.id,
      player_id: seat,
      hole_number: 1,
      swigs: 0,
      mulligans: 1,
    });

    const { error } = await player.db.from("scores").upsert(
      {
        round_id: round.id,
        player_id: seat,
        hole_number: 1,
        swigs: 4,
      },
      { onConflict: "player_id,hole_number" },
    );
    expect(error).toBeNull();

    const { data } = await adminClient()
      .from("scores")
      .select("swigs, mulligans")
      .eq("player_id", seat)
      .eq("hole_number", 1)
      .single();
    expect(data).toMatchObject({ swigs: 4, mulligans: 1 });
  });

  it("refuses a negative count outright", async () => {
    const { error } = await player.db.from("scores").insert({
      round_id: round.id,
      player_id: round.seatOf[player.userId],
      hole_number: 1,
      mulligans: -1,
    });
    expect(error).not.toBeNull();
  });
});
