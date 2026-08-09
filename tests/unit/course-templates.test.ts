import { describe, expect, it } from "vitest";

import {
  INVITATIONAL_COURSE,
  reverseCourse,
  templateForHoleCount,
} from "@/lib/course-templates";

describe("INVITATIONAL_COURSE", () => {
  it("is the printed nine-hole card at par 36", () => {
    // The tagline in lib/config.ts promises "Nine pubs. Par 36." — if the card
    // is edited, that copy has to move with it.
    expect(INVITATIONAL_COURSE).toHaveLength(9);
    expect(
      INVITATIONAL_COURSE.reduce((total, hole) => total + hole.par, 0),
    ).toBe(36);
  });

  it("is numbered in playing order", () => {
    expect(INVITATIONAL_COURSE.map((hole) => hole.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("has nowhere to walk after the last hole", () => {
    expect(INVITATIONAL_COURSE.at(-1)?.walk_minutes_to_next).toBeNull();
  });

  it("gives every hole a local rules list, even an empty one", () => {
    // The column is `[]`-defaulted, so a hole without local rules still has
    // an array to read — the sheet never has to guard for undefined.
    for (const hole of INVITATIONAL_COURSE) {
      expect(Array.isArray(hole.penalties)).toBe(true);
    }
  });

  it("prices the local rules it does carry", () => {
    const local = INVITATIONAL_COURSE.flatMap((hole) => hole.penalties);
    expect(local.length).toBeGreaterThan(0);
    for (const rule of local) {
      expect(rule.reason.trim()).not.toBe("");
      expect(rule.strokes).toBeGreaterThan(0);
    }
  });
});

describe("templateForHoleCount", () => {
  it("builds nothing from nothing", () => {
    expect(templateForHoleCount(0)).toEqual([]);
  });

  it("trims the card to a shorter round", () => {
    const holes = templateForHoleCount(3);
    expect(holes).toHaveLength(3);
    expect(holes.map((hole) => hole.venue_name)).toEqual(
      INVITATIONAL_COURSE.slice(0, 3).map((hole) => hole.venue_name),
    );
  });

  it("wraps the card round again for a longer round", () => {
    const holes = templateForHoleCount(18);
    expect(holes).toHaveLength(18);
    expect(holes[9].venue_name).toBe(INVITATIONAL_COURSE[0].venue_name);
    expect(holes[17].venue_name).toBe(INVITATIONAL_COURSE[8].venue_name);
  });

  it("renumbers holes 1..N however many times it wrapped", () => {
    const holes = templateForHoleCount(12);
    expect(holes.map((hole) => hole.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("always ends with nowhere left to walk", () => {
    for (const count of [1, 5, 9, 14]) {
      expect(templateForHoleCount(count).at(-1)?.walk_minutes_to_next).toBeNull();
    }
  });

  it("leaves a gap in the walk times where the card wraps", () => {
    // Known rough edge: hole 9 carries the template's own null walk time, so a
    // wrapped course has no countdown between holes 9 and 10. Pinned so the
    // day someone fixes it, they mean to.
    const holes = templateForHoleCount(18);
    expect(holes[8].walk_minutes_to_next).toBeNull();
    expect(holes[7].walk_minutes_to_next).not.toBeNull();
  });

  it("hands back holes the caller can safely edit", () => {
    const holes = templateForHoleCount(9);
    holes[0].par = 99;
    holes[0].venue_name = "Somewhere else";
    expect(INVITATIONAL_COURSE[0].par).not.toBe(99);
    expect(INVITATIONAL_COURSE[0].venue_name).not.toBe("Somewhere else");
  });

  it("carries the local rules onto the round's own holes", () => {
    const holes = templateForHoleCount(9);
    const source = INVITATIONAL_COURSE.findIndex(
      (hole) => hole.penalties.length > 0,
    );
    expect(holes[source].penalties).toEqual(
      INVITATIONAL_COURSE[source].penalties,
    );
  });

  it("gives each wrapped hole its own copy of the local rules", () => {
    // The spread that copies a template hole is shallow, so without an
    // explicit clone holes 6 and 15 would share one array — and editing a
    // course would reach back into the module constant every later round
    // reads from.
    const holes = templateForHoleCount(18);
    const source = INVITATIONAL_COURSE.findIndex(
      (hole) => hole.penalties.length > 0,
    );
    expect(holes[source].penalties).not.toBe(holes[source + 9].penalties);
    expect(holes[source].penalties[0]).not.toBe(
      holes[source + 9].penalties[0],
    );

    holes[source].penalties[0].strokes = 99;
    expect(holes[source + 9].penalties[0].strokes).not.toBe(99);
    expect(INVITATIONAL_COURSE[source].penalties[0].strokes).not.toBe(99);
  });
});

describe("reverseCourse", () => {
  it("plays the pubs back down the card, renumbered 1..N", () => {
    const reversed = reverseCourse(templateForHoleCount(9));
    expect(reversed.map((hole) => hole.venue_name)).toEqual(
      [...INVITATIONAL_COURSE].reverse().map((hole) => hole.venue_name),
    );
    expect(reversed.map((hole) => hole.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("keeps par, drink and local rules with their pub", () => {
    const reversed = reverseCourse(templateForHoleCount(9));
    // The printed 6th — the Auld Shillelagh and its water hazard — is now
    // the 4th, rule and all.
    const shillelagh = reversed.find(
      (hole) => hole.venue_name === "The Auld Shillelagh",
    );
    expect(shillelagh?.number).toBe(4);
    expect(shillelagh?.par).toBe(6);
    expect(shillelagh?.penalties).toEqual([
      { strokes: 3, reason: "Using the toilet on a water hazard" },
    ]);
  });

  it("walks the same legs the other way", () => {
    // A walk is the same in either direction and lives on the earlier hole
    // of its pair — so the reversed card's walks are the original list
    // reversed and shifted one pub along, ending with nowhere to walk.
    const reversed = reverseCourse(templateForHoleCount(9));
    const originalWalks = INVITATIONAL_COURSE.map(
      (hole) => hole.walk_minutes_to_next,
    );
    expect(reversed.map((hole) => hole.walk_minutes_to_next)).toEqual([
      2, 23, 13, 22, 7, 14, 12, 8, null,
    ]);
    // Same set of legs, so the 19th-hole estimate is direction-blind.
    expect(
      reversed.reduce((sum, hole) => sum + (hole.walk_minutes_to_next ?? 0), 0),
    ).toBe(originalWalks.reduce((sum: number, walk) => sum + (walk ?? 0), 0));
  });

  it("does not touch the card it was handed", () => {
    const original = templateForHoleCount(9);
    const before = original.map((hole) => hole.venue_name);
    reverseCourse(original);
    expect(original.map((hole) => hole.venue_name)).toEqual(before);
    expect(original.map((hole) => hole.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("reverses a two-pub course without inventing a walk", () => {
    const reversed = reverseCourse([
      { number: 1, walk_minutes_to_next: 8 },
      { number: 2, walk_minutes_to_next: null },
    ]);
    expect(reversed).toEqual([
      { number: 1, walk_minutes_to_next: 8 },
      { number: 2, walk_minutes_to_next: null },
    ]);
  });
});
