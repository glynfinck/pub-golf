"use client";

import { PendingLabel } from "@/components/ui/pending-label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { countWord } from "@/lib/format";

/**
 * Confirming a mulligan. This is the one control on the play screen
 * that destroys something — the swigs already on the hole — so it says the
 * number out loud before it wipes it, and the cancel is the wide target.
 *
 * Presentational on purpose: the taking itself lives in PlayView, which owns
 * the swig debounce and has to settle it before the hole is wiped.
 */
export function MulliganSheet({
  open,
  onOpenChange,
  onConfirm,
  pending,
  busy,
  holeNumber,
  swigs,
  strokes,
  left,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
  /** The wait has earned the putt (useAction's delayed flag). */
  busy: boolean;
  holeNumber: number;
  /** What's on the hole right now, and about to be wiped. */
  swigs: number;
  strokes: number;
  /** Mulligans the player has left, this one included. */
  left: number;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl">
        <SheetHeader className="pb-0 text-center">
          <SheetTitle className="eyebrow text-center text-foreground">
            Mulligan · Hole {holeNumber}
          </SheetTitle>
          <SheetDescription className="text-center text-xs">
            {swigs > 0
              ? `The ${countWord(swigs)} ${swigs === 1 ? "swig" : "swigs"} on this hole come off the card and you start the drink again — a half pint, for +${strokes}.`
              : `You start the drink again — a half pint, for +${strokes}.`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-6">
          <p className="text-center text-[11px] text-muted-foreground">
            {left === 1
              ? "Your last one of the round."
              : `${countWord(left)} left after this one would be ${countWord(left - 1)}.`}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            data-testid="take-mulligan"
            className="flex min-h-12 items-center justify-center rounded-xl border-[1.5px] border-marker bg-marker/10 text-sm font-bold text-marker disabled:opacity-40"
          >
            <PendingLabel
              pending={pending}
              busy={busy}
              label="Take it — wipe the hole"
              pendingLabel="Pouring the half"
            />
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex min-h-12 items-center justify-center rounded-xl border border-border text-sm font-bold"
          >
            Play it out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
