import { describe, expect, it } from "vitest";

import {
  MINUTES_PER_HOLE,
  NO_FIGURE,
  panelSlots,
  walkKmOf,
} from "@/lib/caddy/panel";
import { ROUTE_OBJECTIVES } from "@/lib/caddy/route-graph";
import { summarise } from "@/components/ui/picker-row";
import { WALK_MINUTES_PER_KM } from "@/lib/geo";

/**
 * The drawer's tab, and the walks it offers.
 *
 * Two complaints, one shape. The tab said something different at every act —
 * "The brief", "The brief · walk drawn", "The walks · the long way", "Dressing
 * the card", "The card · 9 holes" — five wordings and five widths on the one
 * control a host reaches for most. And the walks arrived as ten chips holding
 * up to forty-six characters of prose each, so nothing lined up and there was
 * nothing to compare them on.
 *
 * Both answers are data, not layout: three fixed slots whose figures come from
 * one function, and a name/why pair on every route. Which means both are
 * provable here rather than in a browser.
 */

describe("the panel's three slots", () => {
  it("fills all three from a walk", () => {
    expect(panelSlots({ holes: 9, km: 2.4 })).toEqual({
      holes: "9 holes",
      walk: "2.4 km",
      time: `${Math.round(2.4 * WALK_MINUTES_PER_KM + 9 * MINUTES_PER_HOLE)} min`,
    });
  });

  it("never leaves a slot blank", () => {
    // The whole point of fixed slots is that the row does not change height.
    // A blank collapses it; a dash says "not known yet", which is true.
    for (const input of [
      { holes: null, km: null },
      { holes: 9, km: null },
      { holes: null, km: 2.4 },
      { holes: 0, km: 0 },
    ]) {
      const slots = panelSlots(input);
      for (const [name, value] of Object.entries(slots)) {
        expect(`${name}: ${value.length > 0}`).toBe(`${name}: true`);
      }
    }
  });

  it("says a dash for a figure it does not have", () => {
    const empty = panelSlots({ holes: null, km: null });
    expect(empty).toEqual({
      holes: NO_FIGURE,
      walk: NO_FIGURE,
      time: NO_FIGURE,
    });
  });

  it("refuses a time built from half the facts", () => {
    // Walking time alone reads as the length of the night, and it is about a
    // fifth of it — so a time needs both halves or it is not offered.
    expect(panelSlots({ holes: 9, km: null }).time).toBe(NO_FIGURE);
    expect(panelSlots({ holes: null, km: 2.4 }).time).toBe(NO_FIGURE);
    expect(panelSlots({ holes: 9, km: 2.4 }).time).not.toBe(NO_FIGURE);
  });

  it("counts the sitting, not just the walking", () => {
    // Nine holes is over an hour of standing in pubs before a step is taken.
    const nine = panelSlots({ holes: 9, km: 0 }).time;
    expect(nine).toBe(`${9 * MINUTES_PER_HOLE} min`);
    expect(9 * MINUTES_PER_HOLE).toBeGreaterThan(0);
  });

  it("keeps the figures short enough for a third of a phone", () => {
    // Three slots across 390px is about 120px each, less the icon. Anything
    // longer than a dozen characters wraps the row it is supposed to hold
    // still.
    const busy = panelSlots({ holes: 18, km: 12.75 });
    for (const value of Object.values(busy)) {
      expect(`${value}: ${value.length}`).toBe(`${value}: ${value.length}`);
      expect(value.length).toBeLessThanOrEqual(12);
    }
  });
});

describe("measuring a landed card", () => {
  const stops = [
    { lat: 51.5, lng: -0.1 },
    { lat: 51.505, lng: -0.1 },
    { lat: 51.51, lng: -0.1 },
  ];

  it("adds the legs up", () => {
    const km = walkKmOf(stops);
    expect(km).not.toBeNull();
    // Two legs of about 556m each.
    expect(km!).toBeGreaterThan(1);
    expect(km!).toBeLessThan(1.2);
  });

  it("skips a stop with no coordinates instead of walking to null island", () => {
    const gapped = [stops[0], { lat: null, lng: null }, stops[2]];
    const km = walkKmOf(gapped);
    // The one measurable leg is the one that does not touch the gap — here,
    // none, so it answers "unknown" rather than a confident zero.
    expect(km).toBeNull();
  });

  it("answers null rather than 0.0 km when nothing can be measured", () => {
    // "0.0 km" over a card whose pubs have no coordinates is a lie; a dash is
    // not.
    expect(walkKmOf([])).toBeNull();
    expect(walkKmOf([stops[0]])).toBeNull();
    expect(walkKmOf([{ lat: null, lng: null }])).toBeNull();
  });

  it("measures a partial card as far as it can", () => {
    const km = walkKmOf([...stops, { lat: null, lng: null }]);
    expect(km).toBe(walkKmOf(stops));
  });
});

describe("the walks' names", () => {
  it("gives every objective a name and a why", () => {
    const missing: string[] = [];
    for (const objective of ROUTE_OBJECTIVES) {
      if (!objective.name?.trim()) missing.push(`${objective.key}: name`);
      if (!objective.why?.trim()) missing.push(`${objective.key}: why`);
      if (!objective.character?.trim()) {
        missing.push(`${objective.key}: character`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps a name short enough to be a card title", () => {
    // The failure this replaces: "most variety — fewest repeats of the same
    // place" as a pill. A name goes in a title; a sentence goes under it.
    const long = ROUTE_OBJECTIVES.filter(
      (objective) => objective.name.length > 15,
    ).map((objective) => `${objective.key}: ${objective.name}`);
    expect(long).toEqual([]);
  });

  it("keeps a why short enough for one line under it", () => {
    const long = ROUTE_OBJECTIVES.filter(
      (objective) => objective.why.length > 42,
    ).map((objective) => `${objective.key}: ${objective.why}`);
    expect(long).toEqual([]);
  });

  it("never repeats a name", () => {
    // Two walks called the same thing is worse than the sentences were: the
    // whole reason for a name is that you can tell them apart at a glance.
    const names = ROUTE_OBJECTIVES.map((objective) => objective.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("does not just restate the name in the why", () => {
    for (const objective of ROUTE_OBJECTIVES) {
      expect(`${objective.key}: ${objective.why.toLowerCase()}`).not.toBe(
        `${objective.key}: ${objective.name.toLowerCase()}`,
      );
    }
  });
});

describe("what a row reads back", () => {
  it("names one or two answers outright", () => {
    expect(summarise(["Pints"], "Any")).toBe("Pints");
    expect(summarise(["Pints", "Halves"], "Any")).toBe("Pints, Halves");
  });

  it("counts the rest rather than truncating a word in half", () => {
    expect(summarise(["Pints", "Halves", "Spirit & mixer"], "Any")).toBe(
      "Pints, Halves +1",
    );
    expect(
      summarise(["Pints", "Halves", "Wine", "Shots", "Cocktails"], "Any"),
    ).toBe("Pints, Halves +3");
  });

  it("says what nothing means, in the field's own words", () => {
    // "None" and "Whatever suits" are different facts, and a row that said
    // "None" to both would be wrong about one of them.
    expect(summarise([], "Whatever suits")).toBe("Whatever suits");
    expect(summarise([], "None")).toBe("None");
  });
});
