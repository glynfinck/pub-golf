import { describe, expect, it } from "vitest";

import { computeStandings, computeSuperlatives } from "@/lib/scoring";
import type { StandingRow } from "@/lib/scoring";

/**
 * The leaderboard at full-table scale.
 *
 * `scoring.test.ts` states the rules as small scorecards, which is the right
 * way to state a rule. This file asks a different question: do those rules
 * still hold when twenty players have eighteen holes between them, ties are
 * everywhere, and the arrays arrive in whatever order Postgres felt like?
 * Nothing here needs a stack, a network or a clock — a leaderboard is a pure
 * function of a card, so its behaviour under load is provable at this tier
 * and belongs at this tier.
 *
 * These are properties, not re-implementations. A test that recomputes the
 * standings a second way only proves the two copies agree; a test that
 * perturbs one input and states what must move (and what must not) survives
 * a rewrite of the function it guards.
 */

const SEATS = 20;
const HOLES = 18;

/** Deterministic to the bit. A stress test that shuffles differently every
 * run is a test that fails differently every run — and this suite is held to
 * "a pass on retry is a failure" like every other. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const next = rng(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/** Pars 3–6, repeating: the same spread the Invitational card carries. */
const COURSE = Array.from({ length: HOLES }, (_, index) => ({
  number: index + 1,
  par: [5, 4, 5, 4, 3, 6, 3, 4, 5][index % 9],
  venue_name: `Pub ${index + 1}`,
}));
const TOTAL_PAR = COURSE.reduce((sum, hole) => sum + hole.par, 0);

const PLAYERS = Array.from({ length: SEATS }, (_, index) => ({
  id: `p${index}`,
  display_name: `Player ${index}`,
  role: index === 0 ? "host" : index === 1 ? "caddy" : "player",
  handicap: 0,
}));

const FILED = {
  filedThrough: HOLES,
  softSubstituteScoresPar: true,
  mulliganStrokes: 1,
};

/**
 * A full card for a full table, deliberately dense with ties: swigs cycle
 * over a short range against a repeating par, so a great many players land on
 * exactly the same score-to-par. Ties are where a leaderboard breaks, and at
 * twenty seats they are the common case rather than the exception.
 */
function fullCard(seed = 7) {
  const next = rng(seed);
  return PLAYERS.flatMap((player) =>
    COURSE.map((hole) => ({
      player_id: player.id,
      hole_number: hole.number,
      swigs: hole.par + Math.floor(next() * 3) - 1,
      mulligans: 0,
    })),
  );
}

const rankOf = (rows: StandingRow[]) =>
  new Map(rows.map((row) => [row.playerId, row.rank]));
const rowFor = (rows: StandingRow[], id: string) => {
  const row = rows.find((candidate) => candidate.playerId === id);
  if (!row) throw new Error(`No standing row for ${id}`);
  return row;
};

describe("the leaderboard at twenty seats and eighteen holes", () => {
  it("places every player by the golf rule, however many share a score", () => {
    const rows = computeStandings(COURSE, PLAYERS, fullCard(), [], "p0", FILED);
    expect(rows).toHaveLength(SEATS);

    // The whole placing rule in one sentence: your rank is one more than the
    // number of players strictly ahead of you. Everything else about shared
    // placings — 1, 2, 2, 4 rather than 1, 2, 2, 3 — follows from it, and it
    // holds at any table size without the test knowing the scores.
    for (const row of rows) {
      const ahead = rows.filter(
        (other) => other.netToPar < row.netToPar,
      ).length;
      expect(row.rank).toBe(ahead + 1);
    }

    // And the list is ordered by the thing it ranks on.
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index].netToPar).toBeGreaterThanOrEqual(
        rows[index - 1].netToPar,
      );
      expect(rows[index].rank).toBeGreaterThanOrEqual(rows[index - 1].rank);
    }

    // A dense field, or this test is proving the easy case.
    expect(new Set(rows.map((row) => row.rank)).size).toBeLessThan(SEATS);
  });

  it("ranks the same table identically however the rows arrive", () => {
    // Postgres promises no order without an ORDER BY, and these three arrays
    // arrive from three separate selects on every render. A placing that
    // depended on which row came back first would be a leaderboard that
    // reshuffles itself on refresh with nobody having drunk anything.
    const scores = fullCard();
    const penalties = PLAYERS.slice(0, 9).map((player, index) => ({
      player_id: player.id,
      strokes: (index % 3) + 1,
    }));

    const first = computeStandings(
      COURSE,
      PLAYERS,
      scores,
      penalties,
      "p0",
      FILED,
    );

    for (const seed of [1, 2, 3]) {
      const again = computeStandings(
        COURSE,
        shuffled(PLAYERS, seed),
        shuffled(scores, seed * 31),
        shuffled(penalties, seed * 71),
        "p0",
        FILED,
      );
      expect(rankOf(again)).toEqual(rankOf(first));
      // Not just the placings: every figure on every row.
      for (const row of first) {
        expect(rowFor(again, row.playerId)).toEqual(row);
      }
    }
  });

  it("never lets a silent table drink its way under par", () => {
    // Twenty players, eighteen filed holes, not one swig recorded. The
    // substitution rule has to hold across the whole card at once: nobody is
    // under par, nobody is ahead, and the field is level on rank 1.
    const rows = computeStandings(COURSE, PLAYERS, [], [], "p0", FILED);
    for (const row of rows) {
      expect(row).toMatchObject({
        gross: TOTAL_PAR,
        toPar: 0,
        holesPlayed: HOLES,
        rank: 1,
      });
    }

    // And the harsh house rule doubles it, for everybody, without exception.
    const max = computeStandings(COURSE, PLAYERS, [], [], "p0", {
      ...FILED,
      softSubstituteScoresPar: false,
    });
    for (const row of max) {
      expect(row).toMatchObject({ gross: TOTAL_PAR * 2, toPar: TOTAL_PAR });
    }
  });

  it("counts a mid-round table hole by hole, each player where they stand", () => {
    // The real shape of a live board: the round is on hole 13, so 12 are
    // filed, and the table is scattered across the one in progress.
    const filedThrough = 12;
    const scores = PLAYERS.flatMap((player, seat) => [
      ...COURSE.slice(0, filedThrough).map((hole) => ({
        player_id: player.id,
        hole_number: hole.number,
        swigs: hole.par,
        mulligans: 0,
      })),
      // Half the table has started hole 13; a third of those have drunk
      // nothing on it yet, which must not count as a hole played.
      ...(seat % 2 === 0
        ? [
            {
              player_id: player.id,
              hole_number: 13,
              swigs: seat % 6 === 0 ? 0 : 2,
              mulligans: 0,
            },
          ]
        : []),
    ]);

    const rows = computeStandings(COURSE, PLAYERS, scores, [], "p0", {
      ...FILED,
      filedThrough,
    });

    for (const row of rows) {
      const seat = Number(row.playerId.slice(1));
      const started = seat % 2 === 0 && seat % 6 !== 0;
      expect(row.holesPlayed).toBe(filedThrough + (started ? 1 : 0));
    }
  });

  it("charges a penalty to one card and leaves nineteen untouched", () => {
    // The property a twenty-seat board most needs: one player's stroke stays
    // one player's stroke. An aggregation that widened by a row would be
    // invisible at four seats and obvious here.
    const scores = fullCard();
    const before = computeStandings(COURSE, PLAYERS, scores, [], "p0", FILED);
    const after = computeStandings(
      COURSE,
      PLAYERS,
      scores,
      [{ player_id: "p7", strokes: 3 }],
      "p0",
      FILED,
    );

    expect(rowFor(after, "p7").gross).toBe(rowFor(before, "p7").gross + 3);
    expect(rowFor(after, "p7").penaltyStrokes).toBe(3);
    for (const row of before) {
      if (row.playerId === "p7") continue;
      // Every figure on the other nineteen cards is untouched. Their PLACING
      // is not, and must not be: p7 falling past a player is precisely how
      // that player moves up, so rank is asserted as "no worse" rather than
      // "identical".
      const { rank, ...untouched } = row;
      expect(rowFor(after, row.playerId)).toMatchObject(untouched);
      expect(rowFor(after, row.playerId).rank).toBeLessThanOrEqual(rank);
    }
  });

  it("charges a mulligan its stroke without buying back the hole", () => {
    const scores = fullCard();
    const before = computeStandings(COURSE, PLAYERS, scores, [], "p0", FILED);

    // p4 wipes hole 9 and starts it again, ending on zero swigs. The reset
    // hole scores the substitute AND the mulligan is still charged — that is
    // the rule that stops a mulligan being a free hole.
    const withMulligan = scores.map((score) =>
      score.player_id === "p4" && score.hole_number === 9
        ? { ...score, swigs: 0, mulligans: 1 }
        : score,
    );
    const after = computeStandings(
      COURSE,
      PLAYERS,
      withMulligan,
      [],
      "p0",
      { ...FILED, mulliganStrokes: 2 },
    );

    const par9 = COURSE[8].par;
    const original = scores.find(
      (score) => score.player_id === "p4" && score.hole_number === 9,
    )!.swigs;
    expect(rowFor(after, "p4").gross).toBe(
      rowFor(before, "p4").gross - original + par9 + 2,
    );
    expect(rowFor(after, "p4").mulligans).toBe(1);
    expect(rowFor(after, "p4").holesPlayed).toBe(HOLES);
  });

  it("never improves a player's placing when their own score goes up", () => {
    // Monotonicity across the whole field: drinking more can cost you places
    // and can cost nobody else theirs. Stated as a property because at twenty
    // seats the interesting failures are in how the sort and the shared
    // placings interact, not in any one arithmetic step.
    const scores = fullCard();
    const before = computeStandings(COURSE, PLAYERS, scores, [], "p0", FILED);

    for (const victim of ["p0", "p11", "p19"]) {
      const worse = scores.map((score) =>
        score.player_id === victim && score.hole_number === 5
          ? { ...score, swigs: score.swigs + 6 }
          : score,
      );
      const after = computeStandings(COURSE, PLAYERS, worse, [], "p0", FILED);

      expect(rowFor(after, victim).rank).toBeGreaterThanOrEqual(
        rowFor(before, victim).rank,
      );
      for (const row of before) {
        if (row.playerId === victim) continue;
        // Everyone else's score is untouched, and their placing can only
        // improve or hold as the victim falls past them.
        expect(rowFor(after, row.playerId).gross).toBe(row.gross);
        expect(rowFor(after, row.playerId).rank).toBeLessThanOrEqual(row.rank);
      }
    }
  });
});

describe("handicaps across a full table", () => {
  it("changes nothing at all when every handicap is zero", () => {
    // The promise the feature was built on: a table that never sets one plays
    // exactly the round it played before handicaps existed.
    const rows = computeStandings(COURSE, PLAYERS, fullCard(), [], "p0", FILED);
    for (const row of rows) {
      expect(row.net).toBe(row.gross);
      expect(row.netToPar).toBe(row.toPar);
      expect(row.handicapApplied).toBe(0);
    }
  });

  it("hands out a filed card's handicap in full, and a live one's pro rata", () => {
    const handicapped = PLAYERS.map((player, seat) => ({
      ...player,
      handicap: seat % 7,
    }));
    const scores = fullCard();

    // Filed: every stroke of it is in play, and net is gross minus the lot.
    const filed = computeStandings(
      COURSE,
      handicapped,
      scores,
      [],
      "p0",
      FILED,
    );
    for (const row of filed) {
      expect(row.handicapApplied).toBe(row.handicap);
      expect(row.net).toBe(row.gross - row.handicap);
    }

    // Live: a share matching the holes played, so nobody is six under before
    // they have drunk anything — and never more than the whole handicap.
    //
    // The card has to stop at hole 9, not merely be filed through 9: a hole
    // past the filed mark with real swigs on it is a hole played, which is
    // the whole point of the live board. Feeding the full card here and
    // expecting half the handicap would be asserting the opposite.
    const throughNine = scores.filter((score) => score.hole_number <= 9);
    const half = computeStandings(COURSE, handicapped, throughNine, [], "p0", {
      ...FILED,
      filedThrough: 9,
    });
    for (const row of half) {
      expect(row.holesPlayed).toBe(9);
      expect(row.handicapApplied).toBe(Math.round(row.handicap / 2));
      expect(row.handicapApplied).toBeLessThanOrEqual(row.handicap);
    }
  });

  it("ranks on net, not gross, when the table is handicapped", () => {
    // Two players, same gross, different handicaps: the one with strokes in
    // hand must finish ahead. Buried in a field of twenty, where a sort that
    // quietly keyed on gross would still look plausible.
    const players = PLAYERS.map((player, seat) => ({
      ...player,
      handicap: seat === 3 ? 8 : 0,
    }));
    const scores = PLAYERS.flatMap((player) =>
      COURSE.map((hole) => ({
        player_id: player.id,
        hole_number: hole.number,
        swigs: hole.par,
        mulligans: 0,
      })),
    );

    const rows = computeStandings(COURSE, players, scores, [], "p0", FILED);
    // Everyone drank the same. Only p3 has strokes, so p3 leads alone and the
    // other nineteen share second.
    expect(rowFor(rows, "p3").rank).toBe(1);
    expect(rowFor(rows, "p3").gross).toBe(TOTAL_PAR);
    for (const row of rows) {
      if (row.playerId === "p3") continue;
      expect(row.rank).toBe(2);
    }
  });
});

describe("the honours board at scale", () => {
  it("never awards the best hole to a drink that never happened", () => {
    // Zeros are everywhere on a twenty-seat card, and a zero is numerically
    // the best hole anyone played. It is also nobody's best hole.
    const scores = PLAYERS.flatMap((player, seat) =>
      COURSE.map((hole) => ({
        player_id: player.id,
        hole_number: hole.number,
        // Every other seat is silent throughout; the rest drink par.
        swigs: seat % 2 === 0 ? 0 : hole.par,
      })),
    );
    // One real under-par hole in the whole field, and it must win.
    scores.push({ player_id: "p1", hole_number: 6, swigs: 1 });

    const honours = computeSuperlatives(COURSE, PLAYERS, scores, []);
    expect(honours.bestHole).toMatchObject({
      name: "Player 1",
      venue: "Pub 6",
      toPar: 1 - COURSE[5].par,
    });
  });

  it("finds the most hazarded player in a field where most have strokes", () => {
    const penalties = PLAYERS.flatMap((player, seat) =>
      Array.from({ length: seat % 5 }, () => ({
        player_id: player.id,
        strokes: 2,
      })),
    );
    // Seats 4, 9, 14 and 19 each carry four penalties; p19 gets one more, so
    // there is a single honest answer.
    penalties.push({ player_id: "p19", strokes: 3 });

    const honours = computeSuperlatives(COURSE, PLAYERS, fullCard(), penalties);
    expect(honours.mostHazarded).toEqual({ name: "Player 19", strokes: 11 });
  });

  it("reads the same honours whatever order the card arrives in", () => {
    // The results page selects holes ordered by number and players by
    // joined_at, but scores and penalties have no ORDER BY at all — so those
    // two arrive in whatever order Postgres felt like, and may differ between
    // one render and the next. The honours board must not.
    //
    // This is the assertion that caught it: bestHole took the first row with
    // the winning figure, so two players level on the night's best hole — par
    // 1 at the World's End, both down in one — were credited alternately as
    // realtime re-rendered the recap.
    const scores = [
      ...fullCard(),
      // A dead heat for the best hole, on two different holes, plus a third
      // player level again on the earlier of them.
      { player_id: "p2", hole_number: 6, swigs: 1, mulligans: 0 },
      { player_id: "p9", hole_number: 3, swigs: 0, mulligans: 0 },
      { player_id: "p14", hole_number: 3, swigs: 0, mulligans: 0 },
    ];
    const penalties = PLAYERS.map((player, seat) => ({
      player_id: player.id,
      strokes: (seat % 4) + 1,
    }));

    const first = computeSuperlatives(COURSE, PLAYERS, scores, penalties);
    for (const seed of [5, 13, 29]) {
      expect(
        computeSuperlatives(
          COURSE,
          PLAYERS,
          shuffled(scores, seed * 17),
          shuffled(penalties, seed * 23),
        ),
      ).toEqual(first);
    }
  });
});
