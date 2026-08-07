"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { takeBreakfastBall } from "@/lib/actions/rounds";
import { countWord } from "@/lib/format";

/**
 * Confirming a breakfast ball. This is the one control on the play screen
 * that destroys something — the swigs already on the hole — so it says the
 * number out loud before it wipes it, and the cancel is the wide target.
 */
export function BreakfastBallSheet({
  open,
  onOpenChange,
  code,
  holeNumber,
  swigs,
  strokes,
  left,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  holeNumber: number;
  /** What's on the hole right now, and about to be wiped. */
  swigs: number;
  strokes: number;
  /** Breakfast balls the player has left, this one included. */
  left: number;
}) {
  const [pending, startTransition] = useTransition();

  function take() {
    startTransition(async () => {
      const result = await takeBreakfastBall(code, holeNumber);
      if (result.error) toast.error(result.error);
      else {
        onOpenChange(false);
        toast("Breakfast ball taken — start the hole again.");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl">
        <SheetHeader className="pb-0 text-center">
          <SheetTitle className="eyebrow text-center text-foreground">
            Breakfast ball · Hole {holeNumber}
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
            onClick={take}
            data-testid="take-breakfast-ball"
            className="flex min-h-12 items-center justify-center rounded-xl border-[1.5px] border-marker bg-marker/10 text-sm font-bold text-marker disabled:opacity-40"
          >
            {pending ? "Pouring the half…" : "Take it — wipe the hole"}
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
