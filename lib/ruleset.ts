/**
 * The back of the card, as a type.
 *
 * `rounds.ruleset` is a jsonb snapshot taken at creation — editing a ruleset
 * later never rewrites a played round. Every screen used to re-declare the
 * handful of keys it needed with its own inline cast, which meant a new rule
 * had to be added in five places and could disagree with itself in four of
 * them. `readRuleset` is the single door: it normalises whatever is in the
 * column, so a round created before a rule existed reads as that rule being
 * off rather than as `undefined`.
 */

/** Deliberately a type alias, not an interface: only aliases get an implicit
 * index signature, and these go straight into a jsonb column typed `Json`. */
export type RulesetPenalty = {
  strokes: number;
  reason: string;
};

export interface RoundRuleset {
  format: "stroke" | "stableford" | "match" | "scramble";
  hazards: boolean;
  /** null when the round is played untimed. */
  holeTimerMinutes: number | null;
  /** Substitute for a filed hole with no swigs: par when true, double when not. */
  softSubstituteScoresPar: boolean;
  /** The house penalty table for this round, on top of the quick shortcuts. */
  penalties: RulesetPenalty[];
  /** Whether the host is handicapping this round at all. */
  handicaps: boolean;
  /** Breakfast balls per player for the whole round. 0 turns them off. */
  breakfastBalls: number;
  /** What one breakfast ball costs on the card. */
  breakfastBallStrokes: number;
}

const FORMATS = ["stroke", "stableford", "match", "scramble"] as const;

export const RULESET_DEFAULTS: RoundRuleset = {
  format: "stroke",
  hazards: true,
  holeTimerMinutes: null,
  softSubstituteScoresPar: true,
  penalties: [],
  handicaps: false,
  breakfastBalls: 0,
  breakfastBallStrokes: 1,
};

function isFormat(value: unknown): value is RoundRuleset["format"] {
  return FORMATS.includes(value as RoundRuleset["format"]);
}

/** A whole, non-negative number, or the fallback. Rejects NaN and Infinity. */
function counted(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

/**
 * A hole's local rules, read out of its jsonb column. Same defensive parse as
 * the round's own penalty table — the two are the same shape and end up side
 * by side on the same sheet.
 */
export function readHolePenalties(value: unknown): RulesetPenalty[] {
  return penaltyTable(value);
}

function penaltyTable(value: unknown): RulesetPenalty[] {
  if (!Array.isArray(value)) return [];
  const table: RulesetPenalty[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { strokes, reason } = entry as Partial<RulesetPenalty>;
    if (typeof reason !== "string" || reason.trim() === "") continue;
    if (typeof strokes !== "number" || !Number.isFinite(strokes)) continue;
    table.push({ strokes: Math.round(strokes), reason });
  }
  return table;
}

/**
 * Read a round's snapshotted ruleset, filling in anything it predates.
 * Never throws: a card is a bit of fun, not a contract, and a malformed
 * ruleset must not take a round down mid-hole.
 */
export function readRuleset(json: unknown): RoundRuleset {
  if (!json || typeof json !== "object" || Array.isArray(json))
    return { ...RULESET_DEFAULTS, penalties: [] };

  const raw = json as Record<string, unknown>;
  const timer = raw.holeTimerMinutes;

  return {
    format: isFormat(raw.format) ? raw.format : RULESET_DEFAULTS.format,
    hazards:
      typeof raw.hazards === "boolean" ? raw.hazards : RULESET_DEFAULTS.hazards,
    holeTimerMinutes:
      typeof timer === "number" && Number.isFinite(timer) && timer > 0
        ? Math.round(timer)
        : null,
    softSubstituteScoresPar:
      typeof raw.softSubstituteScoresPar === "boolean"
        ? raw.softSubstituteScoresPar
        : RULESET_DEFAULTS.softSubstituteScoresPar,
    penalties: penaltyTable(raw.penalties),
    handicaps:
      typeof raw.handicaps === "boolean"
        ? raw.handicaps
        : RULESET_DEFAULTS.handicaps,
    breakfastBalls: counted(
      raw.breakfastBalls,
      RULESET_DEFAULTS.breakfastBalls,
    ),
    breakfastBallStrokes: counted(
      raw.breakfastBallStrokes,
      RULESET_DEFAULTS.breakfastBallStrokes,
    ),
  };
}
