import type { RulesetPenalty } from "@/lib/ruleset";
import { QUICK_PENALTIES } from "@/lib/rules";

export interface PenaltyOption {
  label: string;
  strokes: number;
  reason: string;
  /** "hole" marks a local rule — it is only on the card at this pub. */
  scope: "house" | "hole";
}

/** Cut a reason down to something that fits a 44px target: everything up to
 * the first dash or comma is the name of the offence, the rest is small
 * print. */
function labelFor(reason: string, strokes: number): string {
  return `${reason.split(/[—,]/)[0].trim()} +${strokes}`;
}

/**
 * The penalty menu for one hole.
 *
 * QUICK_PENALTIES first (their labels are the house shorthand), then any
 * extra presets this round's ruleset carries, then the hole's own local
 * rules. The house order never shifts from hole to hole — the sheet is the
 * drunkest interaction in the app and muscle memory is worth more than
 * putting the novelty on top.
 *
 * `reason` is the join key everywhere (the undo, the ×N count), so it stays
 * unique: a local rule that redeclares a house offence overrides its strokes
 * where the house entry already sits, rather than adding a second row that
 * the undo could not tell apart.
 */
export function penaltyOptions(
  rulesetPenalties: RulesetPenalty[] | undefined,
  holePenalties?: RulesetPenalty[] | null,
): PenaltyOption[] {
  // Copy each entry, not just the array: the module constant outlives every
  // request on the server, so a shared object would leak between rounds.
  const options: PenaltyOption[] = QUICK_PENALTIES.map((quick) => ({
    ...quick,
    scope: "house" as const,
  }));
  const byReason = new Map(options.map((option) => [option.reason, option]));

  for (const preset of rulesetPenalties ?? []) {
    if (byReason.has(preset.reason)) continue;
    const option: PenaltyOption = {
      label: labelFor(preset.reason, preset.strokes),
      strokes: preset.strokes,
      reason: preset.reason,
      scope: "house",
    };
    byReason.set(option.reason, option);
    options.push(option);
  }

  for (const local of holePenalties ?? []) {
    const existing = byReason.get(local.reason);
    if (existing) {
      // The pub's price for an offence the house also lists. Same row, so the
      // undo still finds it; new strokes, because this hole says so.
      existing.strokes = local.strokes;
      existing.label = labelFor(local.reason, local.strokes);
      continue;
    }
    const option: PenaltyOption = {
      label: labelFor(local.reason, local.strokes),
      strokes: local.strokes,
      reason: local.reason,
      scope: "hole",
    };
    byReason.set(option.reason, option);
    options.push(option);
  }

  return options;
}
