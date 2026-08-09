import { describe, expect, it } from "vitest";

import { penaltyOptions } from "@/lib/penalty-options";
import { PENALTY_PRESETS, QUICK_PENALTIES } from "@/lib/rules";

/** The quick shortcuts as they come back off the sheet: same entries, tagged
 * with where they came from. */
const HOUSE_SHORTCUTS = QUICK_PENALTIES.map((quick) => ({
  ...quick,
  scope: "house",
}));

describe("penaltyOptions", () => {
  it("offers just the house shortcuts when a round carries no presets", () => {
    expect(penaltyOptions(undefined)).toEqual(HOUSE_SHORTCUTS);
    expect(penaltyOptions([])).toEqual(HOUSE_SHORTCUTS);
  });

  it("puts the house shortcuts first", () => {
    const options = penaltyOptions(PENALTY_PRESETS);
    expect(options.slice(0, QUICK_PENALTIES.length)).toEqual(HOUSE_SHORTCUTS);
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
      scope: "house",
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

describe("penaltyOptions — local rules", () => {
  it("changes nothing when the hole carries none", () => {
    const house = penaltyOptions(PENALTY_PRESETS);
    expect(penaltyOptions(PENALTY_PRESETS, [])).toEqual(house);
    expect(penaltyOptions(PENALTY_PRESETS, null)).toEqual(house);
    expect(penaltyOptions(PENALTY_PRESETS, undefined)).toEqual(house);
  });

  it("puts the hole's own rules last, marked as local", () => {
    // The house order never shifts hole to hole — the sheet is the drunkest
    // interaction in the app, and muscle memory is worth more than novelty.
    const options = penaltyOptions(undefined, [
      { strokes: 2, reason: "Drinking before the pass is complete" },
    ]);
    expect(options.slice(0, QUICK_PENALTIES.length)).toEqual(HOUSE_SHORTCUTS);
    expect(options[options.length - 1]).toEqual({
      label: "Drinking before the pass is complete +2",
      strokes: 2,
      reason: "Drinking before the pass is complete",
      scope: "hole",
    });
  });

  it("keeps every local rule in the order the course listed them", () => {
    const options = penaltyOptions(undefined, [
      { strokes: 2, reason: "Left hand only" },
      { strokes: 3, reason: "Not down in one" },
    ]);
    expect(
      options.filter((option) => option.scope === "hole").map((o) => o.reason),
    ).toEqual(["Left hand only", "Not down in one"]);
  });

  it("lets a hole reprice a house offence without duplicating it", () => {
    // reason is the join key for the undo and the ×N count, so two rows
    // sharing one would be indistinguishable on the way back off the card.
    const houseReason = QUICK_PENALTIES[0].reason;
    const options = penaltyOptions(PENALTY_PRESETS, [
      { strokes: 7, reason: houseReason },
    ]);
    const matching = options.filter((option) => option.reason === houseReason);
    expect(matching).toHaveLength(1);
    expect(matching[0].strokes).toBe(7);
    expect(matching[0].label).toContain("+7");
    // Repriced in place: it keeps its spot at the top of the sheet.
    expect(options[0].reason).toBe(houseReason);
  });

  it("leaves the module constants untouched when a hole reprices one", () => {
    const houseReason = QUICK_PENALTIES[0].reason;
    const houseStrokes = QUICK_PENALTIES[0].strokes;
    penaltyOptions(undefined, [{ strokes: 19, reason: houseReason }]);
    expect(QUICK_PENALTIES[0].strokes).toBe(houseStrokes);
    // And the next round gets the house price back.
    expect(penaltyOptions(undefined)[0].strokes).toBe(houseStrokes);
  });
});
