import { describe, expect, it } from "vitest";

import { computeStandings } from "@/lib/scoring";
import { adminClient } from "@/tests/support/clients";
import type { Actor } from "@/tests/support/clients";
import {
  seatTable,
  storedHoles,
  storedScores,
  storedSeats,
} from "@/tests/support/table";
import type { Table } from "@/tests/support/table";

import { expectDenied } from "../db/helpers/assert";

/**
 * A whole night, played the whole way through, by twenty phones at once.
 *
 * Every other test in this tier takes one moment and crowds it. This one
 * takes the long shape instead: eighteen holes, twenty sessions, the round
 * walking forward under the table the entire time, and one question at the
 * end — is the card exactly the card everybody drank?
 *
 * The answer has to come from the stored rows and nothing else. Not one
 * assertion here trusts a PostgREST response, because under this much
 * concurrency a 204 describes a request, not a row.
 */

const TABLE = 20;
const HOLES = 18;

/**
 * The intended card, as a pure function of seat and hole.
 *
 * Deterministic so a failure names the same hole twice running, and spread
 * either side of par so the leaderboard has real ties to resolve.
 */
function intendedSwigs(seat: number, hole: number): number {
  return 1 + ((seat * 7 + hole * 3) % 5);
}

/** Two players go quiet for a hole each: the substitute has to cover them. */
const SILENT: ReadonlyArray<{ seat: number; hole: number }> = [
  { seat: 3, hole: 5 },
  { seat: 11, hole: 12 },
];

const isSilent = (seat: number, hole: number) =>
  SILENT.some((gap) => gap.seat === seat && gap.hole === hole);

describe("eighteen holes with twenty on the card", () => {
  /** The write every phone sends, on its own session. */
  function fileSwigs(table: Table, actor: Actor, hole: number, swigs: number) {
    return actor.db.from("scores").upsert(
      {
        round_id: table.round.id,
        player_id: table.seatOf(actor),
        hole_number: hole,
        swigs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "player_id,hole_number" },
    );
  }

  /** What the officials do between pubs: file the hole, walk, tee up. */
  async function walkTo(table: Table, hole: number) {
    const { error: walking } = await table.host.db
      .from("rounds")
      .update({ current_hole: hole, hole_phase: "walking" })
      .eq("id", table.round.id);
    expect(walking).toBeNull();
    const { error: live } = await table.caddy.db
      .from("rounds")
      .update({ hole_phase: "live" })
      .eq("id", table.round.id);
    expect(live).toBeNull();
  }

  it("plays a full card and stores exactly what the table drank", async () => {
    const table = await seatTable({
      size: TABLE,
      holes: HOLES,
      currentHole: 1,
    });

    for (let hole = 1; hole <= HOLES; hole += 1) {
      // The hole itself: twenty upserts in flight, no coordination.
      const results = await Promise.all(
        table.everyone
          .map((actor, seat) =>
            isSilent(seat, hole)
              ? null
              : fileSwigs(table, actor, hole, intendedSwigs(seat, hole)),
          )
          .filter((write) => write !== null),
      );
      for (const { error } of results) expect(error).toBeNull();

      // Mid-round, the table tries to run ahead of the caddy. The window
      // guard is the only thing stopping a card being filled in at the bar,
      // and it has to hold while twenty legitimate writes are landing.
      if (hole === 5) {
        const cheats = await Promise.all(
          table.players
            .slice(0, 4)
            .map((player) => fileSwigs(table, player, 12, 1)),
        );
        for (const { error } of cheats) expectDenied(error);
      }

      if (hole < HOLES) await walkTo(table, hole + 1);
    }

    const { error: filed } = await table.host.db
      .from("rounds")
      .update({ status: "finished" })
      .eq("id", table.round.id);
    expect(filed).toBeNull();

    // ---- What is actually on the card ----
    const rows = await storedScores(table.round.id);
    expect(rows).toHaveLength(TABLE * HOLES - SILENT.length);

    // One row per player-hole. A duplicate here is the upsert conflict target
    // failing under load, which no count on its own would reveal.
    const keys = rows.map((row) => `${row.player_id}:${row.hole_number}`);
    expect(new Set(keys).size).toBe(keys.length);

    // And every figure is the figure that phone sent.
    const swigsAt = new Map(keys.map((key, index) => [key, rows[index].swigs]));
    table.everyone.forEach((actor, seat) => {
      for (let hole = 1; hole <= HOLES; hole += 1) {
        const key = `${table.seatOf(actor)}:${hole}`;
        if (isSilent(seat, hole)) {
          expect(swigsAt.has(key)).toBe(false);
        } else {
          expect(swigsAt.get(key)).toBe(intendedSwigs(seat, hole));
        }
      }
    });
    // Nobody reached hole 12 during hole 5 — the only card missing from it is
    // the seat that stayed silent there when the table really arrived.
    expect(rows.filter((row) => row.hole_number === 12)).toHaveLength(
      TABLE - SILENT.filter((gap) => gap.hole === 12).length,
    );

    // ---- And the leaderboard the app would draw from it ----
    const [holes, seats] = await Promise.all([
      storedHoles(table.round.id),
      storedSeats(table.round.id),
    ]);
    const standings = computeStandings(holes, seats, rows, [], undefined, {
      filedThrough: HOLES,
      softSubstituteScoresPar: true,
      mulliganStrokes: 1,
    });

    // The expectation is built from the intended card, not from the stored
    // one — otherwise this only proves computeStandings agrees with itself.
    const parAt = new Map(holes.map((hole) => [hole.number, hole.par]));
    const expectedGross = table.everyone.map((_, seat) => {
      let gross = 0;
      for (let hole = 1; hole <= HOLES; hole += 1) {
        // A drink nobody recorded never happened: the filed hole scores par,
        // never a free ride under it.
        gross += isSilent(seat, hole)
          ? parAt.get(hole)!
          : intendedSwigs(seat, hole);
      }
      return gross;
    });

    const grossBySeat = new Map(
      standings.map((row) => [row.playerId, row.gross]),
    );
    table.everyone.forEach((actor, seat) => {
      expect(grossBySeat.get(table.seatOf(actor))).toBe(expectedGross[seat]);
    });

    // Everyone played every hole — the two silent ones included, because a
    // filed hole is played whether or not anybody drank on it.
    for (const row of standings) expect(row.holesPlayed).toBe(HOLES);

    // The winner is whoever the intended card says, and they are on top of
    // the stored one too.
    const best = Math.min(...expectedGross);
    const shouldWin = table.everyone
      .filter((_, seat) => expectedGross[seat] === best)
      .map((actor) => table.seatOf(actor));
    expect(shouldWin).toContain(standings[0].playerId);
    expect(standings[0].rank).toBe(1);
  });

  it("keeps a late tap that lands after the caddy calls the hole", async () => {
    // The one-hole grace, under load. The play screen debounces swigs by
    // 400ms and `advanceHole` moves current_hole the instant the caddy taps,
    // so a swig tapped a heartbeat earlier arrives against a hole that is
    // already filed. Refusing it silently scored that player the substitute
    // while their own screen showed their swigs — a green suite hid exactly
    // that once, which is why it is asserted at this tier and not a browser's.
    const table = await seatTable({ size: TABLE, holes: HOLES, currentHole: 1 });

    // Most of the table files hole 1 in time, four are still mid-debounce,
    // and two never drank on it at all — those two are the control, because
    // the grace has to end somewhere and they are the ones who test where.
    const intime = table.everyone.slice(0, TABLE - 6);
    const late = table.everyone.slice(TABLE - 6, TABLE - 2);
    const neverDrank = table.everyone.slice(TABLE - 2);
    const landed = await Promise.all(
      intime.map((actor, seat) => fileSwigs(table, actor, 1, seat + 1)),
    );
    for (const { error } of landed) expect(error).toBeNull();

    await walkTo(table, 2);

    // Now the debounced taps arrive, aimed at the hole just filed. Hole 1 is
    // exactly one behind the live hole, so the grace covers them.
    const lateWrites = await Promise.all(
      late.map((actor) => fileSwigs(table, actor, 1, 4)),
    );
    for (const { error } of lateWrites) expect(error).toBeNull();

    const rows = await storedScores(table.round.id);
    expect(rows.filter((row) => row.hole_number === 1)).toHaveLength(TABLE - 2);
    for (const actor of late) {
      const mine = rows.find(
        (row) => row.player_id === table.seatOf(actor) && row.hole_number === 1,
      );
      expect(mine?.swigs).toBe(4);
    }

    // The grace is exactly one hole wide. Once the round has walked on to 3,
    // hole 1 is two behind and a first write to it is a backfill again — the
    // substitute it already scored stands.
    await walkTo(table, 3);
    const tooLate = await Promise.all(
      neverDrank.map((actor) => fileSwigs(table, actor, 1, 1)),
    );
    for (const { error } of tooLate) expectDenied(error);

    const after = await storedScores(table.round.id);
    expect(after.filter((row) => row.hole_number === 1)).toHaveLength(TABLE - 2);
  });

  it("converges on one hole when both officials call it together", async () => {
    // Two officials with the round bar in front of them, both tapping "hole
    // out" as the table finishes. `advanceHole` writes an explicit target
    // rather than an increment, so they converge instead of skipping a pub —
    // asserted here with the whole table writing underneath them.
    const table = await seatTable({ size: TABLE, holes: HOLES, currentHole: 7 });

    await Promise.all([
      ...table.everyone.map((actor, seat) =>
        fileSwigs(table, actor, 7, (seat % 4) + 1),
      ),
      table.host.db
        .from("rounds")
        .update({ current_hole: 8, hole_phase: "walking" })
        .eq("id", table.round.id),
      table.caddy.db
        .from("rounds")
        .update({ current_hole: 8, hole_phase: "walking" })
        .eq("id", table.round.id),
    ]);

    const { data, error } = await adminClient()
      .from("rounds")
      .select("current_hole, hole_phase")
      .eq("id", table.round.id)
      .single();
    if (error) throw error;
    expect(data.current_hole).toBe(8);
    expect(data.hole_phase).toBe("walking");

    // And nobody's swigs were lost to the two writes landing together.
    const rows = await storedScores(table.round.id);
    expect(rows.filter((row) => row.hole_number === 7)).toHaveLength(TABLE);
  });
});
