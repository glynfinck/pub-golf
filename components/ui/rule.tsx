import { cn } from "@/lib/utils";

/**
 * Thin-thick double rule, the printed scorecard's section divider.
 * `busy` sets the masthead sweeping — the screen-level sign that the round
 * is committing something, carried by line-work every screen already has.
 * `head` gives a rule opening a screen the printer's spacing: tighter to
 * the trim above, more air below — the ink of a double rule sits low, so
 * even spacing reads as the rule sinking into the content under it.
 */
export function RuleDouble({
  className,
  busy,
  head,
}: {
  className?: string;
  busy?: boolean;
  head?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "rule-double",
        busy && "rule-busy",
        head && "-mt-1 mb-1",
        className,
      )}
    />
  );
}
