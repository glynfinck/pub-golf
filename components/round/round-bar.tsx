"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, CircleHelp } from "lucide-react";
import { RulesSheet } from "@/components/round/rules-sheet";
import { RuleDouble } from "@/components/ui/rule";
import type { RoundBundle } from "@/lib/data/rounds";

/**
 * The round's masthead: the way out, what you're in, and the rules — with
 * the double rule hung underneath it the way a head rule hangs from a
 * paper's name (tight above, roomier below; the mb-1 stretches the
 * screen's gap to 20px).
 *
 * Round routes sit outside the tab bar on purpose — a live round is a
 * focused flow — so this row is the only exit. It is a plain link, not a
 * confirm: leaving the screen never leaves the round, and the clubhouse
 * shows the round as live the moment you land there.
 */
export function RoundBar({
  round,
  holes,
  hole,
  busy,
}: {
  round: RoundBundle["round"];
  holes: RoundBundle["holes"];
  /** The hole whose local rules the sheet lists beside the house tariff. */
  hole?: number;
  /** Sets the rule sweeping while the round commits something. */
  busy?: boolean;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);

  return (
    <div className="mb-1 flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <Link
          href="/"
          data-testid="round-exit"
          className="-ml-2 flex min-h-11 w-fit items-center gap-1 rounded-lg px-2 text-xs font-bold text-fairway"
        >
          <ChevronLeft size={16} aria-hidden />
          Clubhouse
        </Link>
        <span className="min-w-0 px-1.5 text-center">
          <span className="block truncate font-serif text-sm leading-tight italic">
            {round.name}
          </span>
          <span
            className="tabular block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground"
            style={{ textIndent: "0.3em" }}
          >
            {round.code}
          </span>
        </span>
        <button
          type="button"
          data-testid="round-help"
          aria-label="Rules and how to play"
          aria-haspopup="dialog"
          onClick={() => setRulesOpen(true)}
          className="-mr-2.5 flex size-11 items-center justify-center justify-self-end rounded-full text-fairway"
        >
          <CircleHelp size={21} aria-hidden />
        </button>
      </div>
      <RuleDouble busy={busy} />

      <RulesSheet
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        round={round}
        holes={holes}
        hole={hole}
      />
    </div>
  );
}
