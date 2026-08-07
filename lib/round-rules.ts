/**
 * The back of the card in plain English: one list, read by the lobby before
 * the round and by the rules sheet during it. A rule that is not in force
 * does not get a line — an empty "Hazards: none" reads as a rule too.
 *
 * `id` is the stable handle on a line: the lobby swaps the abstract pace
 * line for its scheduled tee times by id, and the tests assert on ids
 * rather than on copy that is allowed to be rewritten.
 */

import type { RoundRuleset } from "@/lib/ruleset";
import { readHolePenalties } from "@/lib/ruleset";
import { formatDuration, roundMinutes } from "@/lib/time";

export interface RuleLine {
  id: string;
  label: string;
  value: string;
}

/** The slice of a hole row these lines are derived from — structural, so
 * the unit tier never has to build a full database row. */
export interface RuleHole {
  number: number;
  par: number;
  hazard: string | null;
  penalties: unknown;
  walk_minutes_to_next: number | null;
}

export function roundRuleLines(
  ruleset: RoundRuleset,
  holes: RuleHole[],
): RuleLine[] {
  const par = holes.reduce((sum, hole) => sum + hole.par, 0);
  const walkTotal = holes.reduce(
    (sum, hole) => sum + (hole.walk_minutes_to_next ?? 0),
    0,
  );
  const hazardHoles = holes
    .filter((hole) => hole.hazard)
    .map((hole) => hole.number);
  const localRuleHoles = holes
    .filter((hole) => readHolePenalties(hole.penalties).length > 0)
    .map((hole) => hole.number);

  const lines: RuleLine[] = [
    { id: "holes", label: `${holes.length} holes`, value: `par ${par}` },
    {
      id: "pace",
      label: "Expected pace",
      value: `~${formatDuration(
        roundMinutes(holes.length, ruleset.minutesPerPub, walkTotal),
      )}`,
    },
  ];
  if (ruleset.hazards && hazardHoles.length > 0) {
    lines.push({
      id: "hazards",
      label: "Hazards in force",
      value: hazardHoles.join(" · "),
    });
  }
  if (ruleset.holeTimerMinutes) {
    lines.push({
      id: "timer",
      label: "Timed holes",
      value: `${ruleset.holeTimerMinutes} min`,
    });
  }
  if (ruleset.softSubstituteScoresPar) {
    lines.push({
      id: "soft-substitute",
      label: "Soft substitutes",
      value: "score par",
    });
  }
  if (localRuleHoles.length > 0) {
    lines.push({
      id: "local-rules",
      label: "Local rules",
      value: localRuleHoles.join(" · "),
    });
  }
  if (ruleset.mulligans > 0) {
    lines.push({
      id: "mulligans",
      label: "Mulligans",
      value: `${ruleset.mulligans} each · +${ruleset.mulliganStrokes}`,
    });
  }
  if (ruleset.handicaps) {
    lines.push({ id: "handicaps", label: "Handicaps", value: "net scoring" });
  }
  return lines;
}

/**
 * The same rules compressed to chip length for the live play screen — a
 * glance, not a sentence, so every label has to survive a 10px uppercase
 * setting without wrapping. Card facts (hole count, pace) are not rules
 * and stay off; a round with nothing in force gets an empty list and the
 * screen shows no chip row at all.
 */
export function roundRuleChips(
  ruleset: RoundRuleset,
  holes: RuleHole[],
): RuleLine[] {
  const compact: Record<string, (line: RuleLine) => string> = {
    timer: (line) => line.value,
    hazards: (line) => `hazards ${line.value}`,
    "soft-substitute": () => "0 scores par",
    "local-rules": (line) => `local ${line.value}`,
    mulligans: () => `mulligans ×${ruleset.mulligans}`,
    handicaps: () => "net",
  };
  return roundRuleLines(ruleset, holes).flatMap((line) => {
    const label = compact[line.id]?.(line);
    return label ? [{ ...line, label }] : [];
  });
}
