import { describe, expect, it } from "vitest";

import {
  RULESET_DEFAULTS,
  readHolePenalties,
  readRuleset,
} from "@/lib/ruleset";

/**
 * The ruleset is a jsonb snapshot taken when a round is created, so the column
 * holds every shape the app has ever written — including shapes from before a
 * rule existed. Reading it can never throw and can never surprise: a card is a
 * bit of fun, not a contract, and a malformed ruleset must not take a round
 * down on hole six.
 */

describe("readRuleset — rounds that predate a rule", () => {
  it("reads an empty ruleset as every new rule being off", () => {
    expect(readRuleset({})).toEqual(RULESET_DEFAULTS);
  });

  it("turns handicaps and breakfast balls off for a round that never had them", () => {
    // The shape createRound wrote before this feature landed. It must keep
    // scoring exactly as it did on the night.
    const legacy = readRuleset({
      format: "stroke",
      hazards: true,
      holeTimerMinutes: 20,
      softSubstituteScoresPar: true,
      penalties: [{ strokes: 2, reason: "Skipping a hole entirely" }],
    });
    expect(legacy.handicaps).toBe(false);
    expect(legacy.breakfastBalls).toBe(0);
    expect(legacy.breakfastBallStrokes).toBe(1);
    // And everything it did say is left alone.
    expect(legacy.holeTimerMinutes).toBe(20);
    expect(legacy.penalties).toEqual([
      { strokes: 2, reason: "Skipping a hole entirely" },
    ]);
  });

  it("survives null, a string, and an array where an object belongs", () => {
    for (const junk of [null, undefined, "stroke play", 7, []]) {
      expect(() => readRuleset(junk)).not.toThrow();
      expect(readRuleset(junk)).toEqual(RULESET_DEFAULTS);
    }
  });
});

describe("readRuleset — a full ruleset", () => {
  it("round-trips everything createRound writes", () => {
    const written = {
      format: "stableford" as const,
      hazards: false,
      holeTimerMinutes: 20,
      softSubstituteScoresPar: false,
      penalties: [{ strokes: 3, reason: "Spilling someone else's drink" }],
      handicaps: true,
      breakfastBalls: 2,
      breakfastBallStrokes: 1,
    };
    expect(readRuleset(written)).toEqual(written);
  });

  it("reads an untimed round as no timer rather than zero minutes", () => {
    // A zero-minute hole would arm a deadline that has already passed.
    expect(readRuleset({ holeTimerMinutes: null }).holeTimerMinutes).toBeNull();
    expect(readRuleset({ holeTimerMinutes: 0 }).holeTimerMinutes).toBeNull();
  });
});

describe("readRuleset — junk normalises rather than throws", () => {
  it("refuses a format nobody plays", () => {
    expect(readRuleset({ format: "beer pong" }).format).toBe("stroke");
  });

  it("floors a negative or fractional allowance to something countable", () => {
    expect(readRuleset({ breakfastBalls: -3 }).breakfastBalls).toBe(0);
    expect(readRuleset({ breakfastBalls: 2.6 }).breakfastBalls).toBe(3);
    expect(readRuleset({ breakfastBalls: NaN }).breakfastBalls).toBe(0);
    expect(readRuleset({ breakfastBalls: "two" }).breakfastBalls).toBe(0);
  });

  it("drops penalty rows that are not a penalty", () => {
    const { penalties } = readRuleset({
      penalties: [
        { strokes: 2, reason: "Queue jumping" },
        { strokes: 2 },
        { reason: "No strokes on it" },
        { strokes: "two", reason: "Strokes as a word" },
        { strokes: 1, reason: "   " },
        null,
        "not a penalty",
      ],
    });
    expect(penalties).toEqual([{ strokes: 2, reason: "Queue jumping" }]);
  });

  it("reads a penalty table that is not a list as no table at all", () => {
    expect(readRuleset({ penalties: "all of them" }).penalties).toEqual([]);
  });
});

describe("readHolePenalties", () => {
  it("reads a hole's local rules out of its column", () => {
    expect(readHolePenalties([{ strokes: 2, reason: "Left hand only" }])).toEqual(
      [{ strokes: 2, reason: "Left hand only" }],
    );
  });

  it("reads an empty column as a hole with no local rules", () => {
    // Every hole written before this feature has the default `[]`, and every
    // hole the builder saves without local rules has it too.
    expect(readHolePenalties([])).toEqual([]);
    expect(readHolePenalties(null)).toEqual([]);
    expect(readHolePenalties(undefined)).toEqual([]);
  });
});
