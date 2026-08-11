"use client";

import { useState } from "react";
import { ReportBugSheet } from "@/components/support/report-bug-sheet";

/**
 * The clubhouse door onto the report sheet — the one that is always there,
 * whatever screen the trouble was on. The other door is in the round's rules
 * sheet, where a report arrives already knowing which hole you were on.
 *
 * It sits beside the build stamp on the Profile screen on purpose: that is
 * the line a player is looking at when they have decided something is wrong
 * with the app rather than with their round.
 */
export function ReportBugLink() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-testid="report-bug-open"
        className="flex min-h-11 items-center px-3 text-xs font-bold text-fairway"
      >
        Report a bug
      </button>
      <ReportBugSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
