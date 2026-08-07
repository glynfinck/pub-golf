import { describe, expect, it } from "vitest";

import { roundRuleLines, type RuleHole } from "@/lib/round-rules";
import { RULESET_DEFAULTS } from "@/lib/ruleset";

function hole(number: number, over: Partial<RuleHole> = {}): RuleHole {
  return {
    number,
    par: 3,
    hazard: null,
    penalties: null,
    walk_minutes_to_next: null,
    ...over,
  };
}

function ids(lines: { id: string }[]): string[] {
  return lines.map((line) => line.id);
}

describe("roundRuleLines", () => {
  it("always opens with the card and the pace", () => {
    const lines = roundRuleLines({ ...RULESET_DEFAULTS }, [
      hole(1),
      hole(2, { par: 4 }),
    ]);
    expect(lines[0]).toEqual({ id: "holes", label: "2 holes", value: "par 7" });
    // 2 pubs × the default 20 minutes, no walks on the card.
    expect(lines[1]).toEqual({
      id: "pace",
      label: "Expected pace",
      value: "~40m",
    });
  });

  it("counts the walks into the pace, treating null as no walk", () => {
    const lines = roundRuleLines({ ...RULESET_DEFAULTS }, [
      hole(1, { walk_minutes_to_next: 12 }),
      hole(2, { walk_minutes_to_next: null }),
    ]);
    expect(lines[1].value).toBe("~52m");
  });

  it("gives a rule a line only when it is in force", () => {
    // Defaults: untimed, no breakfast balls, no handicaps, no hazard holes —
    // none of those may appear as an empty "none" line.
    const lines = roundRuleLines({ ...RULESET_DEFAULTS }, [hole(1)]);
    expect(ids(lines)).toEqual(["holes", "pace", "soft-substitute"]);
  });

  it("reads the whole card when everything is on", () => {
    const lines = roundRuleLines(
      {
        ...RULESET_DEFAULTS,
        holeTimerMinutes: 12,
        handicaps: true,
        breakfastBalls: 2,
        breakfastBallStrokes: 1,
      },
      [
        hole(1, { hazard: "water" }),
        hole(2),
        hole(3, {
          hazard: "sand",
          penalties: [{ strokes: 2, reason: "Drinking before the pass" }],
        }),
      ],
    );
    expect(ids(lines)).toEqual([
      "holes",
      "pace",
      "hazards",
      "timer",
      "soft-substitute",
      "local-rules",
      "breakfast-balls",
      "handicaps",
    ]);
    const byId = Object.fromEntries(lines.map((line) => [line.id, line.value]));
    expect(byId["hazards"]).toBe("1 · 3");
    expect(byId["timer"]).toBe("12 min");
    expect(byId["local-rules"]).toBe("3");
    expect(byId["breakfast-balls"]).toBe("2 each · +1");
    expect(byId["handicaps"]).toBe("net scoring");
  });

  it("keeps hazard holes off the card when the round turns hazards off", () => {
    const lines = roundRuleLines({ ...RULESET_DEFAULTS, hazards: false }, [
      hole(1, { hazard: "water" }),
    ]);
    expect(ids(lines)).not.toContain("hazards");
  });

  it("stays silent on substitutes when they score double par", () => {
    // Mirrors the lobby: the line reads "score par" or is absent — the
    // harsher default needs no advertising.
    const lines = roundRuleLines(
      { ...RULESET_DEFAULTS, softSubstituteScoresPar: false },
      [hole(1)],
    );
    expect(ids(lines)).not.toContain("soft-substitute");
  });

  it("ignores malformed local-rule jsonb rather than counting it", () => {
    const lines = roundRuleLines({ ...RULESET_DEFAULTS }, [
      hole(1, { penalties: [{ strokes: "two", reason: "" }] }),
      hole(2, { penalties: "not an array" }),
    ]);
    expect(ids(lines)).not.toContain("local-rules");
  });
});
