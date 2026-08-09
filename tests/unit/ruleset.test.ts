import { describe, expect, it } from "vitest";

import {
  RULESET_DEFAULTS,
  readHolePenalties,
  readRuleset,
  stampMembers,
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

  it("turns handicaps and mulligans off for a round that never had them", () => {
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
    expect(legacy.mulligans).toBe(0);
    expect(legacy.mulliganStrokes).toBe(1);
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
      holeTimerMinutes: 25,
      minutesPerPub: 25,
      scheduledTeeOff: "2026-08-15T18:00:00.000Z",
      softSubstituteScoresPar: false,
      penalties: [{ strokes: 3, reason: "Spilling someone else's drink" }],
      handicaps: true,
      mulligans: 2,
      mulliganStrokes: 1,
    };
    // `members` is deliberately absent from what createRound writes: a round
    // is born uncovered and is stamped at tee-off, never at creation. So it
    // reads back as off, which is what a free round should read as.
    expect(readRuleset(written)).toEqual({ ...written, members: false });
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
    expect(readRuleset({ mulligans: -3 }).mulligans).toBe(0);
    expect(readRuleset({ mulligans: 2.6 }).mulligans).toBe(3);
    expect(readRuleset({ mulligans: NaN }).mulligans).toBe(0);
    expect(readRuleset({ mulligans: "two" }).mulligans).toBe(0);
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

describe("the members' flag on the snapshot", () => {
  it("reads a round from before the green fee existed as uncovered", () => {
    expect(readRuleset({ format: "stroke" }).members).toBe(false);
    expect(RULESET_DEFAULTS.members).toBe(false);
  });

  it("counts only a real boolean, exactly like the guard in Postgres", () => {
    // `ruleset_members` compares against jsonb `true`, so a string "true"
    // in the column is not the flag. Both sides of the wire agree or the
    // trigger and the screen disagree about who is covered.
    expect(readRuleset({ members: true }).members).toBe(true);
    expect(readRuleset({ members: "true" }).members).toBe(false);
    expect(readRuleset({ members: 1 }).members).toBe(false);
  });

  it("stamps without normalising anything else — the snapshot is history", () => {
    // Keys this build has never heard of survive the stamp: a round created
    // by an older or newer deploy must read back exactly as it was dealt.
    const dealt = { format: "stableford", somethingNew: [1, 2], mulligans: 2 };
    expect(stampMembers(dealt)).toEqual({ ...dealt, members: true });
  });

  it("stamps a ruleset that is missing, or is not an object at all", () => {
    for (const junk of [null, undefined, "stroke play", 7, []]) {
      expect(stampMembers(junk)).toEqual({ members: true });
    }
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

describe("the schedule on the snapshot", () => {
  it("reads a round from before the schedule existed as the old fixed pace, unscheduled", () => {
    const ruleset = readRuleset({ format: "stroke", hazards: true });
    expect(ruleset.minutesPerPub).toBe(20);
    expect(ruleset.scheduledTeeOff).toBeNull();
  });

  it("keeps the pace and the advertised tee a round was created with", () => {
    const ruleset = readRuleset({
      minutesPerPub: 25,
      scheduledTeeOff: "2026-08-15T18:00:00.000Z",
    });
    expect(ruleset.minutesPerPub).toBe(25);
    expect(ruleset.scheduledTeeOff).toBe("2026-08-15T18:00:00.000Z");
  });

  it("refuses a pace that could not run a round", () => {
    expect(readRuleset({ minutesPerPub: 0 }).minutesPerPub).toBe(20);
    expect(readRuleset({ minutesPerPub: -5 }).minutesPerPub).toBe(20);
    expect(readRuleset({ minutesPerPub: NaN }).minutesPerPub).toBe(20);
    expect(readRuleset({ minutesPerPub: "half an hour" }).minutesPerPub).toBe(20);
  });

  it("reads an empty or non-string tee as unscheduled", () => {
    expect(readRuleset({ scheduledTeeOff: "" }).scheduledTeeOff).toBeNull();
    expect(readRuleset({ scheduledTeeOff: 1755280800000 }).scheduledTeeOff).toBeNull();
  });
});
