"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PlaceSearch, type FoundPub } from "@/components/course/place-search";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import { swapHolePub } from "@/lib/actions/rounds";
import type { HoleWithVenue } from "@/lib/data/rounds";

/**
 * The locked-door sheet: officials point a hole at a different pub without
 * touching the card. Par, the drink, the hazard and the local rules stay on
 * the hole — they were never the pub's — and every swig and penalty already
 * written keys on the hole number, so nobody's standing changes.
 *
 * No map here, unlike the builder's search. This is a decision made on a
 * pavement with the group waiting, and the pub being picked is usually the
 * one across the road: the list finds it, and the by-name row always does.
 */
export function SwapPubSheet({
  open,
  onOpenChange,
  code,
  hole,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  hole: HoleWithVenue;
}) {
  const { run, pending } = useAction();

  function choose(pub: FoundPub) {
    run(async () => {
      const result = await swapHolePub(code, hole.number, {
        venue_id: pub.venue_id,
        venue_name: pub.venue_name,
      });
      if (result.error) return result;
      onOpenChange(false);
      toast.success(`Hole ${hole.number} is now ${pub.venue_name}.`);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl">
        <SheetHeader className="pb-0 text-center">
          <SheetTitle className="eyebrow text-center text-foreground">
            Hole {hole.number} · change the pub
          </SheetTitle>
          <SheetDescription className="text-center text-xs">
            {hole.venue_name} comes off. Par {hole.par}, {hole.drink} and every
            swig already on the card stay exactly where they are.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <PlaceSearch
            mode="pick"
            title="Where are we drinking instead?"
            actionLabel="Choose"
            actionAria={(venue) => `Play hole ${hole.number} at ${venue}`}
            onAdd={choose}
            onCancel={() => onOpenChange(false)}
            nextHoleNumber={hole.number}
          />
          {pending ? (
            <p className="pt-2 text-center text-[11px] text-muted-foreground">
              Moving the hole on every phone…
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The button that opens it, sized and worded for the moment it is used:
 * standing outside somewhere that isn't letting anyone in. */
export function SwapPubButton({
  code,
  hole,
  label = "This pub is shut — pick another",
  className,
}: {
  code: string;
  hole: HoleWithVenue;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="swap-pub"
        onClick={() => setOpen(true)}
        className={
          className ??
          "flex min-h-12 items-center justify-center rounded-xl border border-dashed border-border text-sm font-bold text-muted-foreground"
        }
      >
        {label}
      </button>
      <SwapPubSheet
        open={open}
        onOpenChange={setOpen}
        code={code}
        hole={hole}
      />
    </>
  );
}
