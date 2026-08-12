import { describe, expect, it } from "vitest";

import {
  drinkForHazard,
  HAZARDS,
  hazardsOn,
  readHazard,
  type HazardId,
} from "@/lib/hazards";
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

describe("drinkForHazard", () => {
  it("leaves the caddy's own words alone almost always", () => {
    // The guard is a backstop, not an editor. Anything it cannot positively
    // identify as the forbidden pairing goes through untouched.
    [
      ["bunker", "Irish whiskey shot"],
      ["bunker", "Sambuca"],
      ["bunker", "Half of stout"],
      ["bunker", "Half pint of bitter"],
      ["water", "Pint of rotating cask ale"],
      ["dogleg", "Pint of stout"],
      [null, "Pint of anything you like"],
    ].forEach(([hazard, drink]) => {
      expect(drinkForHazard(hazard as HazardId | null, drink as string)).toBe(drink);
    });
  });

  it("will not put a pint under a down-in-one", () => {
    // The failure the real model actually produced, having been told in plain
    // words not to: a bunker on "Pint of rotating cask ale".
    ["Pint of rotating cask ale", "Pint of stout", "A jug of cider", "Two pints"].forEach(
      (drink) => {
        const poured = drinkForHazard("bunker", drink);
        expect(poured).not.toBe(drink);
        expect(poured).toBe("Short of your choosing");
      },
    );
  });

  it("changes the drink rather than dropping the hazard", () => {
    // A drink is dressing the host can retype in a tap; a hazard quietly
    // vanishing reads as the caddy having forgotten it.
    expect(drinkForHazard("bunker", "Pint of mild")).toBeTruthy();
  });

  it("says out loud what every hazard does to the glass", () => {
    // Enforcement and prose are two statements of one rule, and the prompt is
    // built from the prose. A hazard that grew a guard without a rule would be
    // enforcing something the caddy was never told.
    HAZARDS.forEach((hazard) => {
      if (hazard.drinkGuard) expect(hazard.drinkRule).toBeTruthy();
    });
  });
});
