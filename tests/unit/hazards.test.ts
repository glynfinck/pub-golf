import { describe, expect, it } from "vitest";

import { HAZARDS, hazardsOn, readHazard } from "@/lib/hazards";
import { INVITATIONAL_COURSE } from "@/lib/course-templates";
import { PENALTY_PRESETS, QUICK_PENALTIES } from "@/lib/rules";

describe("hazards", () => {
  it("gives every hazard a meaning a drinker can act on", () => {
    for (const hazard of HAZARDS) {
      expect(hazard.meaning.length).toBeGreaterThan(20);
      // The label alone explains nothing — "Dogleg" was the whole problem.
      expect(hazard.meaning).not.toBe(hazard.label);
    }
  });

  it("covers exactly the three the schema allows", () => {
    expect(HAZARDS.map((hazard) => hazard.id)).toEqual([
      "water",
      "bunker",
      "dogleg",
    ]);
  });

  it("prices each hazard with an offence the house or a hole can call", () => {
    // A hazard whose offence nobody can call is a rule with no teeth: the
    // reason string is the join key for the penalty sheet, so it has to
    // match something a player can actually tap.
    const callable = new Set([
      ...PENALTY_PRESETS.map((preset) => preset.reason),
      ...QUICK_PENALTIES.map((quick) => quick.reason),
      ...INVITATIONAL_COURSE.flatMap((hole) =>
        hole.penalties.map((penalty) => penalty.reason),
      ),
    ]);
    for (const hazard of HAZARDS) {
      expect(callable).toContain(hazard.offence);
    }
  });

  it("reads a hole's hazard, and shrugs at one without", () => {
    expect(readHazard("dogleg")?.label).toBe("Dogleg");
    expect(readHazard(null)).toBeUndefined();
    expect(readHazard("volcano")).toBeUndefined();
  });

  describe("hazardsOn", () => {
    it("lists only what the course carries, in house order", () => {
      const holes = [
        { number: 1, hazard: "dogleg" },
        { number: 2, hazard: null },
        { number: 3, hazard: "water" },
        { number: 4, hazard: "dogleg" },
      ];
      expect(
        hazardsOn(holes).map((entry) => [
          entry.hazard.id,
          entry.holeNumbers,
        ]),
      ).toEqual([
        ["water", [3]],
        ["dogleg", [1, 4]],
      ]);
    });

    it("says nothing at all about a course with no hazards", () => {
      expect(hazardsOn([{ number: 1, hazard: null }])).toEqual([]);
    });
  });

  it("never quotes a price the hole does not charge", () => {
    // The water note used to promise "two strokes" on a hole whose own
    // local rule prices it at three — and a local rule overrides the house
    // price, so the note was quietly lying to the player reading it.
    for (const hole of INVITATIONAL_COURSE) {
      const quoted = hole.hazard_note?.match(/(\d+)-stroke/);
      if (!quoted) continue;
      const charged = hole.penalties.map((penalty) => penalty.strokes);
      expect(charged).toContain(Number(quoted[1]));
    }
  });

  it("explains every hazard the Invitational actually plays", () => {
    const played = hazardsOn(INVITATIONAL_COURSE);
    expect(played.length).toBeGreaterThan(0);
    for (const { hazard } of played) {
      expect(hazard.meaning).toBeTruthy();
    }
  });
});
