import { describe, expect, it } from "vitest";

import { computeStandings, computeSuperlatives } from "@/lib/scoring";

/**
 * The scoring rules, stated as scorecards rather than as code. Both functions
 * take structural `Pick<>` types, so a plain object literal is a valid row —
 * no database, no fixtures, no clock.
 */

const hole = (number: number, par: number, venue_name = `Pub ${number}`) => ({
  number,
  par,
  venue_name,
});
const player = (id: string, role = "player", handicap = 0) => ({
  id,
  display_name: id,
  role,
  handicap,
});
const score = (
  player_id: string,
  hole_number: number,
  swigs: number,
  mulligans = 0,
) => ({
  player_id,
  hole_number,
  swigs,
  mulligans,
});
const penalty = (player_id: string, strokes: number) => ({
  player_id,
  strokes,
});

/** The house card for these tests: three holes, par 12 all told. */
const COURSE = [hole(1, 5), hole(2, 4), hole(3, 3)];
const SOFT = {
  filedThrough: 0,
  softSubstituteScoresPar: true,
  mulliganStrokes: 1,
};

describe("computeStandings — the substitution rule", () => {
  it("scores nothing when no hole has been filed and no swig recorded", () => {
    const [row] = computeStandings(COURSE, [player("a")], [], [], undefined, SOFT);
    expect(row).toMatchObject({ gross: 0, toPar: 0, holesPlayed: 0 });
  });

  it("substitutes par when a filed hole has zero swigs on it", () => {
    // Zero swigs means the drink never happened — it must never score as a
    // free under-par hole.
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 0)],
      [],
      undefined,
      {
        filedThrough: 1,
        softSubstituteScoresPar: true,
        mulliganStrokes: 1,
      },
    );
    expect(row).toMatchObject({ gross: 5, toPar: 0, holesPlayed: 1 });
  });

  it("substitutes double par on a filed hole when soft mode is off", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 0)],
      [],
      undefined,
      {
        filedThrough: 1,
        softSubstituteScoresPar: false,
        mulliganStrokes: 1,
      },
    );
    expect(row).toMatchObject({ gross: 10, toPar: 5, holesPlayed: 1 });
  });

  it("counts real swigs on a filed hole as recorded", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 3)],
      [],
      undefined,
      {
        filedThrough: 1,
        softSubstituteScoresPar: true,
        mulliganStrokes: 1,
      },
    );
    expect(row).toMatchObject({ gross: 3, toPar: -2, holesPlayed: 1 });
  });

  it("substitutes on filed holes that have no score row at all", () => {
    // Holes 2 and 3 were filed with nothing on the card: par each.
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 4)],
      [],
      undefined,
      {
        filedThrough: 3,
        softSubstituteScoresPar: true,
        mulliganStrokes: 1,
      },
    );
    expect(row).toMatchObject({ gross: 11, toPar: -1, holesPlayed: 3 });
  });

  it("ignores a zero-swig hole that has not been filed yet", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 0)],
      [],
      undefined,
      SOFT,
    );
    expect(row).toMatchObject({ gross: 0, toPar: 0, holesPlayed: 0 });
  });

  it("counts the in-progress hole as soon as it carries a swig", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 2)],
      [],
      undefined,
      SOFT,
    );
    expect(row).toMatchObject({ gross: 2, toPar: -3, holesPlayed: 1 });
  });

  it("defaults to filing nothing and substituting par", () => {
    const [withDefaults] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 2)],
      [],
    );
    expect(withDefaults).toMatchObject({ gross: 2, holesPlayed: 1 });
  });
});

describe("computeStandings — penalties", () => {
  it("adds penalty strokes to gross", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 2)],
      [penalty("a", 3)],
      undefined,
      SOFT,
    );
    expect(row).toMatchObject({ gross: 5, penaltyStrokes: 3, toPar: 0 });
  });

  it("counts a penalty even on a hole nobody has reached", () => {
    // Penalties are filtered by player, never by hole number, so a penalty
    // called before the group arrives already moves the card. Deliberate:
    // a penalty is a penalty, whenever it was called.
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [],
      [penalty("a", 2)],
      undefined,
      SOFT,
    );
    expect(row).toMatchObject({ gross: 2, toPar: 2, holesPlayed: 0 });
  });

  it("attributes penalties only to the player who earned them", () => {
    const rows = computeStandings(
      COURSE,
      [player("a"), player("b")],
      [],
      [penalty("a", 4)],
      undefined,
      SOFT,
    );
    expect(rows.find((row) => row.playerId === "a")?.penaltyStrokes).toBe(4);
    expect(rows.find((row) => row.playerId === "b")?.penaltyStrokes).toBe(0);
  });
});

describe("computeStandings — ordering and placings", () => {
  it("puts the lower score to par first", () => {
    const rows = computeStandings(
      COURSE,
      [player("a"), player("b")],
      [score("a", 1, 7), score("b", 1, 3)],
      [],
      undefined,
      SOFT,
    );
    expect(rows.map((row) => row.playerId)).toEqual(["b", "a"]);
  });

  it("breaks a tie on to-par by who has played more holes", () => {
    const rows = computeStandings(
      COURSE,
      [player("a"), player("b")],
      [score("a", 1, 5), score("b", 1, 5), score("b", 2, 4)],
      [],
      undefined,
      SOFT,
    );
    expect(rows.map((row) => row.playerId)).toEqual(["b", "a"]);
  });

  it("breaks a tie on to-par and holes by the lower gross", () => {
    const rows = computeStandings(
      COURSE,
      [player("a"), player("b")],
      [score("a", 1, 5), score("b", 2, 4)],
      [],
      undefined,
      SOFT,
    );
    expect(rows.map((row) => row.playerId)).toEqual(["b", "a"]);
  });

  it("shares a placing between players level on to-par, golf style", () => {
    const rows = computeStandings(
      COURSE,
      [player("a"), player("b"), player("c")],
      [score("a", 1, 5), score("b", 1, 5), score("c", 1, 7)],
      [],
      undefined,
      SOFT,
    );
    expect(rows.map((row) => row.rank)).toEqual([1, 1, 3]);
  });

  it("shares a placing three ways and resumes at fourth", () => {
    const rows = computeStandings(
      COURSE,
      [player("a"), player("b"), player("c"), player("d")],
      [
        score("a", 1, 5),
        score("b", 1, 5),
        score("c", 1, 5),
        score("d", 1, 6),
      ],
      [],
      undefined,
      SOFT,
    );
    expect(rows.map((row) => row.rank)).toEqual([1, 1, 1, 4]);
  });

  it("shares a placing on equal to-par even when one player is further round", () => {
    // A leaderboard ranks on to-par "thru" however many holes — level after
    // one hole shares the placing with level after two. The sort still puts
    // the further-along player on top.
    const rows = computeStandings(
      COURSE,
      [player("a"), player("b")],
      [score("a", 1, 5), score("b", 1, 5), score("b", 2, 4)],
      [],
      undefined,
      SOFT,
    );
    expect(rows.map((row) => [row.playerId, row.holesPlayed, row.rank])).toEqual(
      [
        ["b", 2, 1],
        ["a", 1, 1],
      ],
    );
  });
});

describe("computeStandings — identity", () => {
  it("marks the requested player and nobody else", () => {
    const rows = computeStandings(
      COURSE,
      [player("a"), player("b")],
      [],
      [],
      "b",
      SOFT,
    );
    expect(rows.filter((row) => row.isYou).map((row) => row.playerId)).toEqual([
      "b",
    ]);
  });

  it("marks nobody when no player id is given", () => {
    const rows = computeStandings(
      COURSE,
      [player("a"), player("b")],
      [],
      [],
      undefined,
      SOFT,
    );
    expect(rows.some((row) => row.isYou)).toBe(false);
  });

  it("carries the player's role onto the row", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a", "caddy")],
      [],
      [],
      undefined,
      SOFT,
    );
    expect(row.role).toBe("caddy");
  });

  it("returns nothing for an empty field", () => {
    expect(computeStandings(COURSE, [], [], [], undefined, SOFT)).toEqual([]);
  });
});

describe("computeStandings — mulligans", () => {
  it("charges the round's price for every one taken", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 4, 1)],
      [],
      undefined,
      SOFT,
    );
    // Four swigs on a par 5, plus one stroke for the half pint.
    expect(row).toMatchObject({ gross: 5, mulligans: 1, toPar: 0 });
  });

  it("charges the price the round snapshotted, not the house one", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 4, 1)],
      [],
      undefined,
      { ...SOFT, mulliganStrokes: 3 },
    );
    expect(row.gross).toBe(7);
  });

  it("counts them from every hole on the card, not just the one being played", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 5, 1), score("a", 2, 4, 2)],
      [],
      undefined,
      { ...SOFT, filedThrough: 2 },
    );
    expect(row).toMatchObject({ mulligans: 3, gross: 12 });
  });

  it("still substitutes when a filed hole was reset and never drunk", () => {
    // The load-bearing rule: zero swigs means the drink never happened, and a
    // mulligan must not become a way to buy a free under-par hole. The
    // substitute lands AND the half pint is still charged.
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 0, 1)],
      [],
      undefined,
      { filedThrough: 1, softSubstituteScoresPar: true, mulliganStrokes: 1 },
    );
    expect(row).toMatchObject({ gross: 6, toPar: 1, holesPlayed: 1 });
  });

  it("does not put an unplayed hole on the card just because one was taken", () => {
    // A mulligan on a hole nobody has filed yet leaves swigs at zero,
    // and an in-progress hole only counts once there are real swigs on it.
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 0, 1)],
      [],
      undefined,
      SOFT,
    );
    expect(row).toMatchObject({ holesPlayed: 0, gross: 1, toPar: 1 });
  });

  it("scores a card with none exactly as it did before they existed", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a")],
      [score("a", 1, 6)],
      [],
      undefined,
      SOFT,
    );
    expect(row).toMatchObject({ gross: 6, mulligans: 0, toPar: 1 });
  });
});

describe("computeStandings — handicaps", () => {
  it("leaves gross alone and takes the shots off net", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a", "player", 3)],
      [score("a", 1, 6), score("a", 2, 5), score("a", 3, 4)],
      [],
      undefined,
      { ...SOFT, filedThrough: 3 },
    );
    // 15 gross against par 12, less a full 3 once every hole is filed.
    expect(row).toMatchObject({
      gross: 15,
      toPar: 3,
      handicap: 3,
      handicapApplied: 3,
      net: 12,
      netToPar: 0,
    });
  });

  it("phases the shots in over the holes actually played", () => {
    // A flat six off from the first hole would put a six-handicap six under
    // before they had drunk anything, and this board is read all night.
    const [row] = computeStandings(
      COURSE,
      [player("a", "player", 6)],
      [score("a", 1, 5)],
      [],
      undefined,
      { ...SOFT, filedThrough: 1 },
    );
    expect(row).toMatchObject({ holesPlayed: 1, handicapApplied: 2, net: 3 });
  });

  it("hands over the whole handicap once the card is filed", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a", "player", 7)],
      [score("a", 1, 5), score("a", 2, 4), score("a", 3, 3)],
      [],
      undefined,
      { ...SOFT, filedThrough: 3 },
    );
    expect(row.handicapApplied).toBe(7);
  });

  it("gives nothing away before a single hole is on the card", () => {
    const [row] = computeStandings(
      COURSE,
      [player("a", "player", 9)],
      [],
      [],
      undefined,
      SOFT,
    );
    expect(row).toMatchObject({
      holesPlayed: 0,
      handicapApplied: 0,
      net: 0,
      netToPar: 0,
    });
  });

  it("does not divide by zero on a course with no holes", () => {
    const [row] = computeStandings(
      [],
      [player("a", "player", 9)],
      [],
      [],
      undefined,
      SOFT,
    );
    expect(row).toMatchObject({ handicapApplied: 0, net: 0, netToPar: 0 });
  });
});

describe("computeStandings — the round is won on net", () => {
  it("ranks the higher handicap ahead despite the worse gross", () => {
    const rows = computeStandings(
      COURSE,
      [player("low", "player", 0), player("high", "player", 6)],
      [
        score("low", 1, 5),
        score("low", 2, 4),
        score("low", 3, 3),
        score("high", 1, 7),
        score("high", 2, 6),
        score("high", 3, 5),
      ],
      [],
      undefined,
      { ...SOFT, filedThrough: 3 },
    );
    // 18 gross beaten into 12 net; 12 gross stays 12 — but "high" is ahead on
    // the tie-break because gross no longer decides anything.
    expect(rows.map((row) => row.playerId)).toEqual(["low", "high"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 1]);
    expect(rows.map((row) => row.net)).toEqual([12, 12]);
    expect(rows.map((row) => row.gross)).toEqual([12, 18]);
  });

  it("puts a handicapped player clear of a level one on net", () => {
    const rows = computeStandings(
      COURSE,
      [player("scratch", "player", 0), player("rusty", "player", 9)],
      [
        score("scratch", 1, 5),
        score("scratch", 2, 4),
        score("scratch", 3, 3),
        score("rusty", 1, 7),
        score("rusty", 2, 6),
        score("rusty", 3, 5),
      ],
      [],
      undefined,
      { ...SOFT, filedThrough: 3 },
    );
    expect(rows[0].playerId).toBe("rusty");
    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ gross: 18, net: 9, netToPar: -3 });
  });

  it("shares a placing on equal net, not on equal gross", () => {
    const rows = computeStandings(
      COURSE,
      [player("a", "player", 0), player("b", "player", 4)],
      [
        score("a", 1, 5),
        score("a", 2, 4),
        score("a", 3, 3),
        score("b", 1, 5),
        score("b", 2, 4),
        score("b", 3, 3),
      ],
      [],
      undefined,
      { ...SOFT, filedThrough: 3 },
    );
    // Identical gross, four shots between them — so no shared placing.
    expect(rows.map((row) => row.gross)).toEqual([12, 12]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(rows[0].playerId).toBe("b");
  });

  it("orders a field of level cards exactly as it did before handicaps", () => {
    // With nobody carrying a handicap, netToPar is toPar and net is gross —
    // every round already on the books keeps the result it finished with.
    const rows = computeStandings(
      COURSE,
      [player("a"), player("b"), player("c")],
      [score("a", 1, 6), score("b", 1, 4), score("c", 1, 6)],
      [],
      undefined,
      { ...SOFT, filedThrough: 1 },
    );
    expect(rows.map((row) => row.playerId)).toEqual(["b", "a", "c"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 2]);
    for (const row of rows) {
      expect(row.net).toBe(row.gross);
      expect(row.netToPar).toBe(row.toPar);
    }
  });
});

describe("computeSuperlatives — mostHazarded", () => {
  it("is nobody when the card is clean", () => {
    const { mostHazarded } = computeSuperlatives(
      COURSE,
      [player("a"), player("b")],
      [score("a", 1, 4)],
      [],
    );
    expect(mostHazarded).toBeNull();
  });

  it("is the player carrying the most strokes, totalled", () => {
    const { mostHazarded } = computeSuperlatives(
      COURSE,
      [player("a"), player("b")],
      [],
      [penalty("a", 2), penalty("a", 2), penalty("b", 3)],
    );
    expect(mostHazarded).toEqual({ name: "a", strokes: 4 });
  });

  it("settles a tie on the order players sit in", () => {
    const { mostHazarded } = computeSuperlatives(
      COURSE,
      [player("b"), player("a")],
      [],
      [penalty("a", 3), penalty("b", 3)],
    );
    expect(mostHazarded?.name).toBe("b");
  });
});

describe("computeSuperlatives — bestHole", () => {
  it("is the lowest single hole against par", () => {
    const { bestHole } = computeSuperlatives(
      COURSE,
      [player("a"), player("b")],
      [score("a", 1, 4), score("b", 2, 1)],
      [],
    );
    expect(bestHole).toEqual({ name: "b", venue: "Pub 2", toPar: -3 });
  });

  it("ignores a hole nobody drank on", () => {
    // An undrunk drink is nobody's best hole, however good the number looks.
    const { bestHole } = computeSuperlatives(
      COURSE,
      [player("a")],
      [score("a", 1, 0), score("a", 2, 3)],
      [],
    );
    expect(bestHole).toEqual({ name: "a", venue: "Pub 2", toPar: -1 });
  });

  it("ignores scores on holes and players it does not recognise", () => {
    const { bestHole } = computeSuperlatives(
      COURSE,
      [player("a")],
      [score("a", 99, 1), score("ghost", 1, 1), score("a", 1, 4)],
      [],
    );
    expect(bestHole).toEqual({ name: "a", venue: "Pub 1", toPar: -1 });
  });

  it("settles a tie on who set the mark first, not on row order", () => {
    // `scores` is selected with no ORDER BY, so "the first row with the best
    // figure" is not a rule — it is whatever Postgres returned this time, and
    // the recap re-renders on every realtime event. Ties go to the earlier
    // hole, and on the same hole to the earlier seat.
    const rows = [score("b", 1, 3), score("a", 1, 3)];
    expect(
      computeSuperlatives(COURSE, [player("a"), player("b")], rows, []).bestHole
        ?.name,
    ).toBe("a");
    // Same answer with the two score rows the other way round.
    expect(
      computeSuperlatives(COURSE, [player("a"), player("b")], [...rows].reverse(), [])
        .bestHole?.name,
    ).toBe("a");
  });

  it("gives a tie to the earlier hole before it looks at the seat", () => {
    // b is level with a on the card, but got there at Pub 1 while a was still
    // walking. Whoever set the mark first keeps it.
    const { bestHole } = computeSuperlatives(
      COURSE,
      [player("a"), player("b")],
      [score("a", 2, 2), score("b", 1, 3)],
      [],
    );
    expect(bestHole).toEqual({ name: "b", venue: "Pub 1", toPar: -2 });
  });
});

describe("computeSuperlatives — steadiest", () => {
  it("is the flattest spread against par", () => {
    const { steadiest } = computeSuperlatives(
      COURSE,
      [player("a"), player("b")],
      [
        score("a", 1, 5),
        score("a", 2, 4), // dead level on both
        score("b", 1, 7),
        score("b", 2, 2), // +2 then −2
      ],
      [],
    );
    expect(steadiest).toEqual({ name: "a" });
  });

  it("needs at least two drunk holes to judge anyone", () => {
    const { steadiest } = computeSuperlatives(
      COURSE,
      [player("a"), player("b")],
      [score("a", 1, 5), score("b", 1, 5), score("b", 2, 0)],
      [],
    );
    // b's second hole has no swigs on it, so b has one judged hole, not two.
    expect(steadiest).toBeNull();
  });

  it("treats a hole with no known par as par zero", () => {
    // An asymmetry worth knowing: bestHole skips a score whose hole is not on
    // the card, steadiest counts it as `swigs − 0` and so reads as wildly
    // unsteady. Pinned here so a change to either is deliberate.
    const { bestHole, steadiest } = computeSuperlatives(
      COURSE,
      [player("a"), player("b")],
      [
        score("a", 1, 5),
        score("a", 99, 3),
        score("b", 1, 6),
        score("b", 2, 5),
      ],
      [],
    );
    expect(bestHole?.name).toBe("a");
    expect(steadiest).toEqual({ name: "b" });
  });
});
