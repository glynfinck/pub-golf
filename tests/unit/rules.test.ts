import { describe, expect, it } from "vitest";

import { PENALTY_PRESETS, QUICK_PENALTIES } from "@/lib/rules";

/** The bounds addPenalty and callPenaltyOn validate against. */
const MIN_STROKES = 1;
const MAX_STROKES = 20;

describe("PENALTY_PRESETS", () => {
  it("stays inside the stroke range the server actions accept", () => {
    for (const preset of PENALTY_PRESETS) {
      expect(preset.strokes).toBeGreaterThanOrEqual(MIN_STROKES);
      expect(preset.strokes).toBeLessThanOrEqual(MAX_STROKES);
      expect(Number.isInteger(preset.strokes)).toBe(true);
    }
  });

  it("lists every reason once", () => {
    // penaltyOptions dedupes by reason, so a duplicate here would silently
    // vanish from the sheet rather than fail anywhere visible.
    const reasons = PENALTY_PRESETS.map((preset) => preset.reason);
    expect(new Set(reasons).size).toBe(reasons.length);
  });
});

describe("QUICK_PENALTIES", () => {
  it("only surfaces penalties that are on the printed card", () => {
    // The quick set is a shortcut into PENALTY_PRESETS. A reason that drifts
    // out of the presets would produce two entries in the sheet for one
    // offence — the dedupe keys on reason, and would no longer match.
    const reasons = new Set(PENALTY_PRESETS.map((preset) => preset.reason));
    for (const quick of QUICK_PENALTIES) {
      expect(reasons).toContain(quick.reason);
    }
  });

  it("agrees with the card on what each offence costs", () => {
    for (const quick of QUICK_PENALTIES) {
      const preset = PENALTY_PRESETS.find(
        (candidate) => candidate.reason === quick.reason,
      );
      expect(preset?.strokes).toBe(quick.strokes);
    }
  });

  it("carries a short label for a one-tap target", () => {
    for (const quick of QUICK_PENALTIES) {
      expect(quick.label).toMatch(/\+\d+$/);
      expect(quick.label.length).toBeLessThanOrEqual(20);
    }
  });
});
