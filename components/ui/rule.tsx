import { cn } from "@/lib/utils";

/** Thin-thick double rule, the printed scorecard's section divider. */
export function RuleDouble({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rule-double", className)} />;
}
