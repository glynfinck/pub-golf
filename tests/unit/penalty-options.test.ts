import { describe, expect, it } from "vitest";

import { penaltyOptions } from "@/lib/penalty-options";
import { PENALTY_PRESETS, QUICK_PENALTIES } from "@/lib/rules";

describe("penaltyOptions", () => {
  it("offers just the house shortcuts when a round carries no presets", () => {
    expect(penaltyOptions(undefined)).toEqual(QUICK_PENALTIES);
    expect(penaltyOptions([])).toEqual(QUICK_PENALTIES);
  });

  it("puts the house shortcuts first", () => {
    const options = penaltyOptions(PENALTY_PRESETS);
    expect(options.slice(0, QUICK_PENALTIES.length)).toEqual(QUICK_PENALTIES);
  });

  it("keeps one entry per offence when the ruleset repeats a shortcut", () => {
    // Every quick penalty is also a preset, so the whole preset table adds
    // only the offences the shortcuts do not already cover.
    const options = penaltyOptions(PENALTY_PRESETS);
    const reasons = options.map((option) => option.reason);
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(options).toHaveLength(
      new Set([
        ...QUICK_PENALTIES.map((quick) => quick.reason),
        ...PENALTY_PRESETS.map((preset) => preset.reason),
      ]).size,
    );
  });

  it("appends an unfamiliar penalty with its strokes", () => {
    const [, , , extra] = penaltyOptions([
      { strokes: 4, reason: "Losing the scorecard" },
    ]);
    expect(extra).toEqual({
      label: "Losing the scorecard +4",
      strokes: 4,
      reason: "Losing the scorecard",
    });
  });

  it("cuts a long reason down to a tappable label", () => {
    // Labels stop at the first dash or comma — the rest of the reason is the
    // small print, and the sheet has a 44px target to fill.
    const options = penaltyOptions([
      { strokes: 2, reason: "Queue jumping — however politely" },
      { strokes: 5, reason: "Being sick, tactical or otherwise" },
    ]);
    expect(options.map((option) => option.label)).toContain(
      "Queue jumping +2",
    );
    expect(options.map((option) => option.label)).toContain("Being sick +5");
  });

  it("leaves the house shortcuts untouched", () => {
    // The returned array is built fresh each call; mutating it must not
    // rewrite the module constant for every later round.
    const options = penaltyOptions(undefined);
    options[0].label = "Tampered";
    expect(QUICK_PENALTIES[0].label).not.toBe("Tampered");
  });
});
