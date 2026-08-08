import { beforeEach, describe, expect, it } from "vitest";

import { adminClient } from "@/tests/support/clients";
import type { Actor } from "@/tests/support/clients";
import { seedScores } from "@/tests/support/factories";
import { seatTable, storedPenalties, storedScores } from "@/tests/support/table";
import type { Table } from "@/tests/support/table";

import { expectDenied } from "../db/helpers/assert";

/**
 * Twenty thumbs on one hole.
 *
 * The play screen debounces taps into an upsert, so a table of twenty is
 * twenty independent write streams onto one round, none of them aware of the
 * others. What survives the scramble is the only thing that matters, so every
 * assertion here re-reads through the admin client — a PostgREST response
 * describes the request it answered, not the row that is there afterwards.
 */

const TABLE = 20;

describe("twenty sessions writing the same round", () => {
  let table: Table;

  /** The write `upsertScore` sends, on the caller's own session. */
  function fileSwigs(
    actor: Actor,
    seatId: string,
    hole: number,
    swigs: number,
  ) {
    return actor.db.from("scores").upsert(
      {
        round_id: table.round.id,
        player_id: seatId,
        hole_number: hole,
        swigs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "player_id,hole_number" },
    );
  }

  beforeEach(async () => {
    table = await seatTable({ size: TABLE, holes: 18, currentHole: 1 });
  });

  it("lands one row per player when the whole table files at once", async () => {
    // Twenty upserts in flight on one hole, each on its own session.
    const results = await Promise.all(
      table.everyone.map((actor, seat) =>
        fileSwigs(actor, table.seatOf(actor), 1, seat + 1),
      ),
    );
    for (const { error } of results) expect(error).toBeNull();

    const rows = await storedScores(table.round.id);
    expect(rows).toHaveLength(TABLE);

    // Not just twenty rows — the RIGHT twenty. A storm that wrote every
    // player's swigs onto one card would also produce a plausible count.
    const swigsBySeat = new Map(rows.map((row) => [row.player_id, row.swigs]));
    table.everyone.forEach((actor, seat) => {
      expect(swigsBySeat.get(table.seatOf(actor))).toBe(seat + 1);
    });
  });

  it("keeps one row each when all twenty race their own debounce", async () => {
    // Forty writes in flight: every phone has two taps outstanding, which is
    // what a mulligan or a slow pub connection produces. Whichever lands
    // second must update, never duplicate.
    const results = await Promise.all(
      table.everyone.flatMap((actor) => [
        fileSwigs(actor, table.seatOf(actor), 1, 3),
        fileSwigs(actor, table.seatOf(actor), 1, 5),
      ]),
    );
    for (const { error } of results) expect(error).toBeNull();

    const rows = await storedScores(table.round.id);
    expect(rows).toHaveLength(TABLE);
    for (const row of rows) expect([3, 5]).toContain(row.swigs);
  });

  it("survives the marker correcting five cards mid-storm", async () => {
    // The caddy works down the marker's card while the table keeps drinking:
    // five players have their own debounce in flight against the marker's
    // edit on the very same row. Twenty rows out, one per seat, every time.
    const corrected = table.players.slice(0, 5);
    const results = await Promise.all([
      ...table.everyone.map((actor) =>
        fileSwigs(actor, table.seatOf(actor), 1, 2),
      ),
      ...corrected.map((player) =>
        fileSwigs(table.caddy, table.seatOf(player), 1, 9),
      ),
    ]);
    for (const { error } of results) expect(error).toBeNull();

    const rows = await storedScores(table.round.id);
    expect(rows).toHaveLength(TABLE);
    const bySeat = new Map(rows.map((row) => [row.player_id, row.swigs]));
    for (const player of corrected) {
      // One hand or the other won; nobody ended up with both, or neither.
      expect([2, 9]).toContain(bySeat.get(table.seatOf(player)));
    }
  });

  it("attributes a storm of self-called penalties to the right cards", async () => {
    // Owning up is the one penalty a player may file, and at a table of
    // twenty they all own up at once. Retraction is keyed on `called_by`, so
    // a storm that shuffled attribution would hand players the power to
    // delete each other's calls.
    const results = await Promise.all(
      table.everyone.map((caller) =>
        caller.db.from("penalties").insert({
          round_id: table.round.id,
          player_id: table.seatOf(caller),
          hole_number: 1,
          strokes: 2,
          reason: "Spilling your own drink",
          called_by: table.seatOf(caller),
        }),
      ),
    );
    for (const { error } of results) expect(error).toBeNull();

    const rows = await storedPenalties(table.round.id);
    expect(rows).toHaveLength(TABLE);
    // Nobody's stroke ended up on anybody else's card in the scramble.
    for (const row of rows) expect(row.called_by).toBe(row.player_id);
    expect(new Set(rows.map((row) => row.player_id)).size).toBe(TABLE);
  });

  it("keeps the marker's calls attributed while nineteen cards move", async () => {
    // Calling a penalty ON someone is an official's act — the policy allows a
    // player only their own card. So this is the real shape of the storm: the
    // caddy works down the table while the table drinks, and every call has
    // to land on the player it was aimed at, under the caddy's name.
    const marked = table.players.slice(0, 8);
    const results = await Promise.all([
      ...table.everyone.map((actor) =>
        fileSwigs(actor, table.seatOf(actor), 1, 3),
      ),
      ...marked.map((player) =>
        table.caddy.db.from("penalties").insert({
          round_id: table.round.id,
          player_id: table.seatOf(player),
          hole_number: 1,
          strokes: 1,
          reason: "Not down in one",
          called_by: table.seatOf(table.caddy),
        }),
      ),
    ]);
    for (const { error } of results) expect(error).toBeNull();

    const rows = await storedPenalties(table.round.id);
    expect(rows).toHaveLength(marked.length);
    const caddySeat = table.seatOf(table.caddy);
    expect(new Set(rows.map((row) => row.player_id))).toEqual(
      new Set(marked.map((player) => table.seatOf(player))),
    );
    for (const row of rows) expect(row.called_by).toBe(caddySeat);
  });

  it("refuses a whole table calling penalties on each other", async () => {
    // Twenty players marking their neighbours would be the fastest way to
    // rig a card, and the policy allows a penalty only on your own seat or
    // an official's call. Under a storm is when a policy that usually holds
    // gets its one chance.
    const results = await Promise.all(
      table.players.map((caller, seat) => {
        const victim = table.players[(seat + 1) % table.players.length];
        return caller.db.from("penalties").insert({
          round_id: table.round.id,
          player_id: table.seatOf(victim),
          hole_number: 1,
          strokes: 20,
          reason: "Spilling your own drink",
          called_by: table.seatOf(caller),
        });
      }),
    );
    for (const { error } of results) expectDenied(error);
    expect(await storedPenalties(table.round.id)).toHaveLength(0);
  });

  it("holds every card shut against nineteen neighbours at once", async () => {
    // RLS is the only real enforcement, and a storm is when a policy that
    // holds in the quiet gets its one chance. The whole table writes a
    // flattering score onto seat 0's card simultaneously.
    const victim = table.players[0];
    const victimSeat = table.seatOf(victim);
    const attackers = table.everyone.filter(
      (actor) => actor !== victim && actor !== table.host && actor !== table.caddy,
    );

    await Promise.all([
      fileSwigs(victim, victimSeat, 1, 7),
      ...attackers.map((attacker) => fileSwigs(attacker, victimSeat, 1, 1)),
    ]);

    // Re-read, never the error: an UPDATE that RLS filters out returns no
    // error and no rows, so success and refusal look identical from here.
    const rows = await storedScores(table.round.id);
    const mine = rows.filter((row) => row.player_id === victimSeat);
    expect(mine).toHaveLength(1);
    expect(mine[0].swigs).toBe(7);
  });

  it("refuses a whole table's worth of writes to a hole not yet teed up", async () => {
    // Twenty phones pre-filling hole 9 during hole 1. Officials are exempt by
    // design (the marker's card roams), so this is the players only.
    const results = await Promise.all(
      table.players.map((player) =>
        fileSwigs(player, table.seatOf(player), 9, 1),
      ),
    );
    for (const { error } of results) expectDenied(error);

    const rows = await storedScores(table.round.id);
    expect(rows.filter((row) => row.hole_number === 9)).toHaveLength(0);
  });
});

describe("the mulligan allowance under a burst", () => {
  it("never lets a card carry more mulligans than the round allows", async () => {
    // The allowance is enforced in a BEFORE trigger that sums the player's
    // OTHER score rows and compares against the ruleset. That is a
    // read-then-check, and two writes in flight together each read a total
    // that does not yet include the other.
    //
    // Two ways it happens at a real table: the marker works down a player's
    // card correcting several holes in a row, and a player taps mulligan on
    // consecutive holes as the round advances — both put more than one raise
    // of this column in flight at once.
    const allowance = 2;
    const table = await seatTable({
      size: 4,
      holes: 18,
      currentHole: 6,
      mulligans: allowance,
    });
    const player = table.players[0];
    const seat = table.seatOf(player);

    // Five holes already on the card, no mulligans on any of them yet.
    await seedScores(
      table.round.id,
      [1, 2, 3, 4, 5].map((hole) => ({
        playerId: seat,
        hole,
        swigs: 4,
        mulligans: 0,
      })),
    );

    // Five raises in flight at once, on five different rows.
    await Promise.all(
      [1, 2, 3, 4, 5].map((hole) =>
        player.db
          .from("scores")
          .update({ mulligans: 1, updated_at: new Date().toISOString() })
          .eq("player_id", seat)
          .eq("hole_number", hole),
      ),
    );

    const rows = await storedScores(table.round.id);
    const taken = rows
      .filter((row) => row.player_id === seat)
      .reduce((sum, row) => sum + row.mulligans, 0);

    // The allowance is the whole point of the column. Whatever the sequence
    // of writes, the card may not end up carrying more than the round sold —
    // and exactly the allowance, not fewer, because the five writers queue on
    // the seat's lock and the first two spend it. Asserted as an equality on
    // purpose: `<= 2` would also pass if the guard had started refusing
    // everything, which is a different bug wearing this test's green.
    expect(taken).toBe(allowance);
  });

  it("still refuses the mulligan that breaks the allowance one at a time", async () => {
    // The uncontended path, as a control: the guard itself is sound, so a
    // failure in the burst above is about concurrency and nothing else.
    const table = await seatTable({
      size: 4,
      holes: 18,
      currentHole: 6,
      mulligans: 2,
    });
    const player = table.players[0];
    const seat = table.seatOf(player);
    await seedScores(
      table.round.id,
      [1, 2, 3].map((hole) => ({
        playerId: seat,
        hole,
        swigs: 4,
        mulligans: 0,
      })),
    );

    for (const hole of [1, 2]) {
      const { error } = await player.db
        .from("scores")
        .update({ mulligans: 1, updated_at: new Date().toISOString() })
        .eq("player_id", seat)
        .eq("hole_number", hole);
      expect(error).toBeNull();
    }

    const { error } = await player.db
      .from("scores")
      .update({ mulligans: 1, updated_at: new Date().toISOString() })
      .eq("player_id", seat)
      .eq("hole_number", 3);
    expectDenied(error);

    const { data } = await adminClient()
      .from("scores")
      .select("mulligans")
      .eq("player_id", seat);
    expect((data ?? []).reduce((sum, row) => sum + row.mulligans, 0)).toBe(2);
  });
});
