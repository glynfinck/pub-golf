import { describe, expect, it } from "vitest";

import { computeLeague, type LeagueRound } from "@/lib/league";

/** A round with one card per entry, ranked in the order given. */
function round(
  code: string,
  playedAt: string,
  cards: { profileId: string; name: string; netToPar: number }[],
): LeagueRound {
  const ranked = [...cards].sort((a, b) => a.netToPar - b.netToPar);
  return {
    code,
    name: `The ${code} Invitational`,
    playedAt,
    cards: cards.map((card) => ({
      ...card,
      gross: 36 + card.netToPar,
      rank: ranked.findIndex((row) => row.netToPar === card.netToPar) + 1,
    })),
  };
}

const AUG_1 = "2026-08-01T22:00:00.000Z";
const AUG_8 = "2026-08-08T22:00:00.000Z";

describe("computeLeague", () => {
  it("is empty with nothing on the table", () => {
    expect(computeLeague([])).toEqual([]);
  });

  it("adds a player's cards up across rounds", () => {
    const table = computeLeague([
      round("A", AUG_1, [
        { profileId: "wren", name: "Wren", netToPar: 2 },
        { profileId: "sam", name: "Sam", netToPar: 6 },
      ]),
      round("B", AUG_8, [
        { profileId: "wren", name: "Wren", netToPar: -2 },
        { profileId: "sam", name: "Sam", netToPar: 4 },
      ]),
    ]);

    const wren = table.find((row) => row.profileId === "wren");
    expect(wren).toMatchObject({
      rounds: 2,
      wins: 2,
      totalToPar: 0,
      averageToPar: 0,
      bestToPar: -2,
      rank: 1,
    });
    expect(table.find((row) => row.profileId === "sam")).toMatchObject({
      rounds: 2,
      wins: 0,
      totalToPar: 10,
      averageToPar: 5,
      rank: 2,
    });
  });

  it("ranks on the average, so turning up is never a penalty", () => {
    // Sam played twice at +4 a round; Wren played once, better. Ranked on
    // the total, Wren's single +5 would beat Sam's +8 — which would mean
    // the way to win a league is to stop entering it.
    const table = computeLeague([
      round("A", AUG_1, [
        { profileId: "wren", name: "Wren", netToPar: 5 },
        { profileId: "sam", name: "Sam", netToPar: 4 },
      ]),
      round("B", AUG_8, [{ profileId: "sam", name: "Sam", netToPar: 4 }]),
    ]);

    expect(table.map((row) => row.profileId)).toEqual(["sam", "wren"]);
    expect(table[0].totalToPar).toBe(8);
    expect(table[1].totalToPar).toBe(5);
  });

  it("splits a level average on rounds played, then on wins", () => {
    const table = computeLeague([
      round("A", AUG_1, [
        { profileId: "wren", name: "Wren", netToPar: 3 },
        { profileId: "sam", name: "Sam", netToPar: 3 },
      ]),
      round("B", AUG_8, [{ profileId: "wren", name: "Wren", netToPar: 3 }]),
    ]);

    expect(table.map((row) => row.profileId)).toEqual(["wren", "sam"]);
    // Level averages share the placing all the same — golf prints a tie.
    expect(table.map((row) => row.rank)).toEqual([1, 1]);
  });

  it("counts every player who shared the win", () => {
    const table = computeLeague([
      round("A", AUG_1, [
        { profileId: "wren", name: "Wren", netToPar: 1 },
        { profileId: "sam", name: "Sam", netToPar: 1 },
      ]),
    ]);
    expect(table.every((row) => row.wins === 1)).toBe(true);
  });

  it("follows a player under the name they last used", () => {
    // One profile, two spellings, one row — and the newest round names it.
    const table = computeLeague([
      round("A", AUG_1, [{ profileId: "dave", name: "Dave", netToPar: 2 }]),
      round("B", AUG_8, [{ profileId: "dave", name: "David", netToPar: 2 }]),
    ]);
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({ name: "David", rounds: 2 });
  });

  it("is not disturbed by the order the rounds arrive in", () => {
    const first = round("A", AUG_1, [
      { profileId: "wren", name: "Wren", netToPar: 2 },
    ]);
    const second = round("B", AUG_8, [
      { profileId: "wren", name: "Wren", netToPar: -4 },
    ]);
    expect(computeLeague([first, second])).toEqual(
      computeLeague([second, first]),
    );
  });
});
