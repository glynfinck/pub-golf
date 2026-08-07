import { cn } from "@/lib/utils";

/**
 * Thin-thick double rule, the printed scorecard's section divider.
 * `busy` sets the masthead sweeping — the screen-level sign that the round
 * is committing something, carried by line-work every screen already has.
 */
export function RuleDouble({
  className,
  busy,
}: {
  className?: string;
  busy?: boolean;
}) {
  return <div aria-hidden className={cn("rule-double", busy && "rule-busy", className)} />;
}
