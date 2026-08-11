import { describe, expect, it } from "vitest";

import { parseDraft, type NewRoundDraft } from "@/lib/new-round-draft";

const full: NewRoundDraft = {
  name: "The September Invitational",
  holes: 12,
  courseId: "course-uuid",
  reversed: true,
  format: "stableford",
  toggles: { hazards: false, timer: true, softSub: true, handicaps: true },
  minutesPerPub: 25,
  teeDate: "2026-09-05T00:00:00.000Z",
  teeMinutes: 1140,
  mulligans: 2,
  rules: [{ strokes: 3, reason: "Queue jumping", on: true, custom: false }],
};

/**
 * A parked draft is a string a *previous build* wrote, read back after a
 * trip off-site. So the only thing this parser owes anyone is never taking
 * the screen down: a draft it cannot read is a fresh form.
 */
describe("parseDraft", () => {
  it("round-trips a whole table", () => {
    expect(parseDraft(JSON.stringify(full))).toEqual(full);
  });

  it("is nothing when nothing was parked", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("")).toBeNull();
  });

  it("refuses anything that is not a draft, rather than throwing", () => {
    for (const junk of ["{", "null", '"a string"', "7", "[1,2]", "{}"]) {
      expect(() => parseDraft(junk)).not.toThrow();
      expect(parseDraft(junk)).toBeNull();
    }
  });

  it("fills in fields a draft from an older build never had", () => {
    const restored = parseDraft(
      JSON.stringify({ name: "The Invitational", holes: 9 }),
    );
    expect(restored).toMatchObject({
      courseId: null,
      reversed: false,
      format: "stroke",
      toggles: {},
      minutesPerPub: 20,
      teeDate: null,
      mulligans: 0,
      rules: [],
    });
  });

  it("drops rule rows that are not rules", () => {
    const restored = parseDraft(
      JSON.stringify({
        ...full,
        rules: [
          { strokes: 2, reason: "Spilling a drink", on: true, custom: false },
          { reason: "No strokes on it" },
          { strokes: 2 },
          null,
          "not a rule",
        ],
      }),
    );
    expect(restored?.rules).toEqual([
      { strokes: 2, reason: "Spilling a drink", on: true, custom: false },
    ]);
  });
});
