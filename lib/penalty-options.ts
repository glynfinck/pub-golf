import { QUICK_PENALTIES } from "@/lib/rules";

export interface PenaltyOption {
  label: string;
  strokes: number;
  reason: string;
}

/** QUICK_PENALTIES first (their labels are the house shorthand), then any
 * extra presets this round's ruleset carries, keyed by reason. */
export function penaltyOptions(
  rulesetPenalties: { strokes: number; reason: string }[] | undefined,
): PenaltyOption[] {
  // Copy each entry, not just the array: the module constant outlives every
  // request on the server, so a shared object would leak between rounds.
  const options: PenaltyOption[] = QUICK_PENALTIES.map((quick) => ({ ...quick }));
  const known = new Set(options.map((option) => option.reason));
  for (const preset of rulesetPenalties ?? []) {
    if (known.has(preset.reason)) continue;
    known.add(preset.reason);
    options.push({
      label: `${preset.reason.split(/[—,]/)[0].trim()} +${preset.strokes}`,
      strokes: preset.strokes,
      reason: preset.reason,
    });
  }
  return options;
}
