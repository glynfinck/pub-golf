import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RuleDouble } from "@/components/ui/rule";

/**
 * The masthead every screen outside the tab bar hangs from: the way back on
 * the left, the screen's identity in the middle, an action on the right,
 * and the double rule hung beneath it the way a head rule hangs from a
 * paper's name — tight above, roomier below (the mb-1 stretches the
 * screen's gap-4 to 20px under the rule).
 *
 * The tab screens don't take one — the tab bar is their navigation — so
 * they hang a bare `<RuleDouble head />` instead.
 */
export function Masthead({
  back,
  center,
  action,
  busy,
}: {
  /** Where the left-hand link leads, and what it says. */
  back: { href: string; label: string; testId?: string };
  /** The identity in the middle: a round's name, or the house mark. */
  center?: React.ReactNode;
  /** An optional 44px control on the right (the round's rules mark). */
  action?: React.ReactNode;
  /** Sets the rule sweeping while the screen commits something. */
  busy?: boolean;
}) {
  return (
    <div className="mb-1 flex flex-col gap-2">
      <div className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center">
        <Link
          href={back.href}
          data-testid={back.testId ?? "masthead-back"}
          className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-lg px-2 text-xs font-bold text-fairway"
        >
          <ChevronLeft size={16} aria-hidden />
          {back.label}
        </Link>
        <div className="min-w-0 px-1.5 text-center">{center}</div>
        <div className="flex items-center justify-self-end">{action}</div>
      </div>
      <RuleDouble busy={busy} />
    </div>
  );
}
