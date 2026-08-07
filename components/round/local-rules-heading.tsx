/**
 * The line on a penalty sheet where the house rules stop and the pub's own
 * begin. The house shortcuts always sit in the same order at the top, so
 * this is the only thing on the sheet that moves hole to hole — it earns a
 * heading rather than being left to a change of colour.
 */
export function LocalRulesHeading() {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1">
      <span className="eyebrow text-hazard">On this hole</span>
      <span aria-hidden className="h-px flex-1 bg-hazard/25" />
    </div>
  );
}
