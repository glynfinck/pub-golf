import { describe, expect, it } from "vitest";

import {
  briefSentence,
  DEFAULT_MEASURES,
  DEFAULT_STRETCH,
  MEASURES,
  measureLabel,
  measuresMeaning,
  readBrief,
  readMeasures,
  readStretch,
  STRETCH_MAX,
  STRETCH_MIN,
  stretchMeaning,
  stretchPhrase,
  VIBES,
} from "@/lib/caddy/brief";
import { briefBlock } from "@/lib/caddy/plan";
import { buildCandidates, EMPTY_FACTS } from "@/lib/caddy/dossier";
import {
  dayLabel,
  dayOptions,
  FIRST_TEE_MINUTES,
  LAST_TEE_MINUTES,
  nudgeTeeOff,
  TEE_MINUTE_STEP,
  teeLine,
  teeOffNote,
} from "@/lib/caddy/tee-off";

/**
 * The brief's own menus, and the rule they kept breaking: a preset list is a
 * decision taken on the host's behalf, and it has to earn that.
 *
 * Four evening chips made a round teeing off at noon unaskable. Four spacing
 * chips made seven minutes unaskable. Both are load-bearing rather than
 * cosmetic — the tee-off decides which pubs are open enough to be on the card
 * at all — so the clamped, continuous versions are what is proved here.
 */

// ————————————————— the clock —————————————————

describe("nudgeTeeOff", () => {
  it("moves by the nudge and stops at the ends of the day", () => {
    expect(nudgeTeeOff(19 * 60, TEE_MINUTE_STEP)).toBe(19 * 60 + 15);
    expect(nudgeTeeOff(19 * 60, -60)).toBe(18 * 60);
    expect(nudgeTeeOff(10, -60)).toBe(FIRST_TEE_MINUTES);
    expect(nudgeTeeOff(LAST_TEE_MINUTES, 60)).toBe(LAST_TEE_MINUTES);
  });

  it("reaches noon, which is the whole point of it", () => {
    // Down from a seven o'clock default, a quarter hour at a time.
    let at = 19 * 60;
    while (at > 12 * 60) at = nudgeTeeOff(at, -TEE_MINUTE_STEP);
    expect(at).toBe(12 * 60);
    expect(teeLine(at, null, null)).toContain("12:00 PM");
  });
});

describe("dayOptions", () => {
  it("offers the whole week from today, named after the first two", () => {
    const week = dayOptions(3); // a Wednesday
    expect(week).toHaveLength(7);
    expect(week[0]).toEqual({ day: 3, label: "Today" });
    expect(week[1]).toEqual({ day: 4, label: "Tomorrow" });
    expect(week[2]).toEqual({ day: 5, label: "Friday" });
    expect(week[6]).toEqual({ day: 2, label: "Tuesday" });
    expect(new Set(week.map((entry) => entry.day)).size).toBe(7);
  });

  it("offers nothing before the browser has said what today is", () => {
    // The server snapshot. Null day means "no day named", which switches
    // every opening-hours check off rather than guessing at one.
    expect(dayOptions(null)).toEqual([]);
    expect(dayLabel(null, null)).toBe("no day set");
    expect(teeLine(19 * 60, null, null)).toBe("First tee 7:00 PM.");
  });

  it("still names a day it cannot place in the week", () => {
    expect(dayLabel(6, null)).toBe("Saturday");
  });
});

describe("teeOffNote", () => {
  it("says something different about a midday tee and an evening one", () => {
    const noon = teeOffNote(12 * 60);
    const evening = teeOffNote(19 * 60);
    const late = teeOffNote(22 * 60);
    expect(noon).not.toBe(evening);
    expect(late).not.toBe(evening);
    // The daytime line has to warn, because midday opening is the thing that
    // actually bites: plenty of pubs are shut and the caddy plans round it.
    expect(noon.toLowerCase()).toContain("not open at midday");
    expect(late.toLowerCase()).toContain("last orders");
  });

  it("answers for every minute of the day", () => {
    for (let minutes = 0; minutes <= LAST_TEE_MINUTES; minutes += 15) {
      expect(teeOffNote(minutes).length).toBeGreaterThan(0);
    }
  });
});

// ————————————————— the spacing dial —————————————————

describe("readStretch", () => {
  it("takes any whole number of minutes on the dial", () => {
    expect(readStretch(7)).toBe(7);
    expect(readStretch(1)).toBe(1);
    expect(readStretch(STRETCH_MAX)).toBe(STRETCH_MAX);
  });

  it("clamps rather than refusing, and defaults what it cannot read", () => {
    expect(readStretch(500)).toBe(STRETCH_MAX);
    expect(readStretch(-4)).toBe(STRETCH_MIN);
    expect(readStretch("soon")).toBe(DEFAULT_STRETCH);
    expect(readStretch(undefined)).toBe(DEFAULT_STRETCH);
  });
});

describe("stretchMeaning", () => {
  it("answers for every position of the dial, not just four of them", () => {
    for (let minutes = STRETCH_MIN; minutes <= STRETCH_MAX; minutes += 1) {
      expect(stretchMeaning(minutes).length).toBeGreaterThan(0);
      expect(stretchPhrase(minutes).length).toBeGreaterThan(0);
    }
  });

  it("says the number back where the number is the useful part", () => {
    expect(stretchMeaning(7)).toContain("7");
    expect(stretchPhrase(7)).toContain("7");
  });
});

// ————————————————— the measures —————————————————

describe("measures", () => {
  it("keeps only measures that exist, in the house's own order", () => {
    expect(readMeasures(["shot", "free-bar", "pint"])).toEqual([
      "pint",
      "shot",
    ]);
    expect(readMeasures("pints")).toEqual([]);
    expect(readMeasures(undefined)).toEqual([]);
  });

  it("defaults to what the app has always written", () => {
    expect(readMeasures(DEFAULT_MEASURES)).toEqual(DEFAULT_MEASURES);
    for (const id of DEFAULT_MEASURES) {
      expect(MEASURES.some((measure) => measure.id === id)).toBe(true);
    }
  });

  it("reads as a clause, however many are ticked", () => {
    expect(measuresMeaning([])).toBe("");
    expect(measuresMeaning(["pint"])).toBe("full pints");
    expect(measuresMeaning(["pint", "half"])).toBe(
      "full pints and halves and two-thirds",
    );
    expect(measuresMeaning(["pint", "half", "shot"])).toContain(", ");
  });

  it("labels every measure it offers", () => {
    for (const measure of MEASURES) {
      expect(measureLabel(measure.id)).toBe(measure.label);
    }
  });
});

describe("briefBlock, on measures", () => {
  const candidates = buildCandidates([
    {
      venueId: "00000000-0000-4000-8000-000000000001",
      name: "The Old Bell",
      address: "1 Example Street",
      rating: 4.2,
      reviewCount: 120,
      lat: 51.5,
      lng: -0.1,
      priceLevel: 2,
      facts: { ...EMPTY_FACTS },
      editorial: null,
      reviews: [],
    },
  ]);
  const brief = readBrief({
    where: "Shoreditch",
    holes: 6,
    measures: ["pint", "half"],
  })!;

  it("briefs the caddy in the same words the chip used", () => {
    const block = briefBlock(brief, candidates);
    expect(block).toContain("full pints");
    expect(block).toContain("halves");
    // The two rules that outrank a preference, said where the preference is.
    expect(block).toContain("hazard");
    expect(block.toLowerCase()).toContain("does not pour");
  });

  it("says nothing at all when nothing is ticked", () => {
    const silent = readBrief({ where: "Shoreditch", holes: 6, measures: [] })!;
    expect(briefBlock(silent, candidates)).not.toContain("Drinks:");
  });
});

// ————————————————— the readback —————————————————

describe("briefSentence", () => {
  it("says the whole brief back in one line", () => {
    const line = briefSentence({
      where: "Shoreditch",
      holes: 9,
      vibe: "traditional",
      stretch: 5,
      strokeKm: null,
    });
    expect(line).toBe(
      "Nine holes round Shoreditch — traditional, about 5 minutes between pubs.",
    );
  });

  it("stops claiming a pace a drawn walk has already overruled", () => {
    // `targetKmFor` short-circuits on the stroke's own arc length and never
    // reads `stretch`, so a sentence quoting the dial would be describing a
    // control that is doing nothing.
    const line = briefSentence({
      where: "Shoreditch",
      holes: 6,
      vibe: "lively",
      stretch: 10,
      strokeKm: 3.42,
    });
    expect(line).toContain("3.4 km");
    expect(line).toContain("walk you drew");
    expect(line).not.toContain("between rounds");
  });

  it("has something to say before a patch is named", () => {
    const line = briefSentence({
      where: "   ",
      holes: 12,
      vibe: "punishing",
      stretch: 0,
      strokeKm: null,
    });
    expect(line).toContain("round here");
    expect(line).toContain("Twelve holes");
  });

  it("names every character the form can offer", () => {
    for (const vibe of VIBES) {
      const line = briefSentence({
        where: "Soho",
        holes: 6,
        vibe: vibe.id,
        stretch: 5,
        strokeKm: null,
      });
      expect(line).toContain(vibe.label.toLowerCase());
    }
  });
});
