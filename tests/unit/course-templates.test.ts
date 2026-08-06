import { describe, expect, it } from "vitest";

import {
  INVITATIONAL_COURSE,
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
});
