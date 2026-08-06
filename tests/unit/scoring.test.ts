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
const player = (id: string, role = "player") => ({
  id,
  display_name: id,
  role,
});
const score = (player_id: string, hole_number: number, swigs: number) => ({
  player_id,
  hole_number,
  swigs,
});
const penalty = (player_id: string, strokes: number) => ({
  player_id,
  strokes,
});

/** The house card for these tests: three holes, par 12 all told. */
const COURSE = [hole(1, 5), hole(2, 4), hole(3, 3)];
const SOFT = { filedThrough: 0, softSubstituteScoresPar: true };

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
      { filedThrough: 1, softSubstituteScoresPar: true },
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
      { filedThrough: 1, softSubstituteScoresPar: false },
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
      { filedThrough: 1, softSubstituteScoresPar: true },
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
      { filedThrough: 3, softSubstituteScoresPar: true },
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

  it("settles a tie on the order the scores arrive", () => {
    const { bestHole } = computeSuperlatives(
      COURSE,
      [player("a"), player("b")],
      [score("b", 1, 3), score("a", 1, 3)],
      [],
    );
    expect(bestHole?.name).toBe("b");
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
