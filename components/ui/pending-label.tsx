import { Putt } from "@/components/ui/putt";
import { cn } from "@/lib/utils";

/**
 * Button innards for a server action in flight. The resting copy swaps to
 * the pending copy the instant the tap lands — the receipt — and the putt
 * comes up only once the wait has earned it (useAction's `busy`). Both
 * copies share one grid cell, so the wider one sets the width and the
 * button never reflows under a thumb mid-tap.
 *
 * Copy convention: a pending label WITH the putt drops its trailing
 * ellipsis (the putt is the ellipsis); a compact one without the mark
 * keeps its own "…".
 */
export function PendingLabel({
  pending,
  busy,
  label,
  pendingLabel,
  putt = true,
}: {
  pending: boolean;
  busy: boolean;
  label: React.ReactNode;
  pendingLabel: React.ReactNode;
  /** Off for compact buttons with no room for the mark. */
  putt?: boolean;
}) {
  return (
    <span className="grid place-items-center">
      <span className={cn("col-start-1 row-start-1", pending && "invisible")}>
        {label}
      </span>
      <span
        aria-live="polite"
        className={cn(
          "col-start-1 row-start-1 inline-flex items-baseline gap-2",
          !pending && "invisible",
        )}
      >
        {pendingLabel}
        {putt ? <Putt className={cn(!(pending && busy) && "invisible")} /> : null}
      </span>
    </span>
  );
}
