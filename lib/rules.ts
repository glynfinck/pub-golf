/** The penalty table from the back of the printed card. */
export const PENALTY_PRESETS = [
  { strokes: 1, reason: "Spilling your own drink" },
  { strokes: 2, reason: "Using the toilet on a water hazard" },
  { strokes: 2, reason: "Missing the time limit on a hole" },
  { strokes: 2, reason: "Skipping a hole entirely" },
  { strokes: 3, reason: "Spilling someone else's drink" },
  { strokes: 3, reason: "Out of bounds — falling over, or off a stool" },
  { strokes: 5, reason: "Being sick, tactical or otherwise" },
  { strokes: 20, reason: "Getting the group thrown out of a pub" },
];

/** Local rules a single hole may add. More than a handful and nobody reads
 * the sheet on the night. */
export const MAX_LOCAL_RULES = 5;

/** What a breakfast ball costs on the card — the half pint you drink to take
 * one. Snapshotted into the ruleset at creation, so raising it later never
 * rescores a round already played. */
export const BREAKFAST_BALL_STROKES = 1;

/** The most breakfast balls a round may hand out per player. */
export const MAX_BREAKFAST_BALLS = 5;

/** The most strokes a handicap may carry — golf's own ceiling. */
export const MAX_HANDICAP = 54;

/** One-tap penalties surfaced on the live scorecard (with +/- undo). */
export const QUICK_PENALTIES = [
  { strokes: 1, label: "Spill +1", reason: "Spilling your own drink" },
  { strokes: 2, label: "Toilet +2", reason: "Using the toilet on a water hazard" },
  { strokes: 3, label: "Off stool +3", reason: "Out of bounds — falling over, or off a stool" },
];
