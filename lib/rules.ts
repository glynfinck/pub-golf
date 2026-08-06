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

/** One-tap penalties surfaced on the live scorecard (with +/- undo). */
export const QUICK_PENALTIES = [
  { strokes: 1, label: "Spill +1", reason: "Spilling your own drink" },
  { strokes: 2, label: "Toilet +2", reason: "Using the toilet on a water hazard" },
  { strokes: 3, label: "Off stool +3", reason: "Out of bounds — falling over, or off a stool" },
];
