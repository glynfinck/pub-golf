"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { RulesSheet } from "@/components/round/rules-sheet";
import { Masthead } from "@/components/shell/masthead";
import { ReportBugSheet } from "@/components/support/report-bug-sheet";
import type { RoundBundle } from "@/lib/data/rounds";

/**
 * The round's masthead: the way out, what you're in, and the rules.
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
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <Masthead
        back={{ href: "/", label: "Clubhouse", testId: "round-exit" }}
        busy={busy}
        center={
          <>
            <span className="block truncate font-serif text-sm leading-tight italic">
              {round.name}
            </span>
            <span
              className="tabular block font-mono text-[9px] font-bold tracking-[0.3em] text-muted-foreground"
              style={{ textIndent: "0.3em" }}
            >
              {round.code}
            </span>
          </>
        }
        action={
          <button
            type="button"
            data-testid="round-help"
            aria-label="Rules and how to play"
            aria-haspopup="dialog"
            onClick={() => setRulesOpen(true)}
            className="-mr-2.5 flex size-11 items-center justify-center rounded-full text-fairway"
          >
            <CircleHelp size={21} aria-hidden />
          </button>
        }
      />

      <RulesSheet
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        round={round}
        holes={holes}
        hole={hole}
        onReportBug={() => {
          setRulesOpen(false);
          setReportOpen(true);
        }}
      />

      {/* Both sheets are owned here so the handover is a swap, never a
          stack — the rules close as the report opens. The round travels
          with the report: the code stays private (it is the join key) and
          only the hole and phase are ever printed. */}
      <ReportBugSheet
        open={reportOpen}
        onOpenChange={setReportOpen}
        roundCode={round.code}
        hole={hole ?? round.current_hole}
        phase={round.status === "live" ? round.hole_phase : round.status}
      />
    </>
  );
}
