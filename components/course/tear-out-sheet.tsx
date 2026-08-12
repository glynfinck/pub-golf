"use client";

import { Button } from "@/components/ui/button";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TearOutNotice } from "@/lib/caddy/credits";

/**
 * Tearing a caddy-planned course out of the book, asked properly.
 *
 * This was one line of hazard ink above a hold-to-confirm, and the line said
 * the right thing — `tearOutNotice` has always produced the correct sentence.
 * What it could not do from there was offer anything: a host reading "the
 * caddy can't rebuild this" had the destructive control under their thumb and
 * no alternative anywhere near it. A warning with no way out is a warning that
 * gets held through.
 *
 * So the two ways on stand beside the way out, and they stand *above* it:
 * keeping the course is the first thing on the sheet, tearing it out is the
 * last. Neither door is a countdown and neither is a guilt clause — "keep it"
 * simply closes the sheet, because the ask box is already on the page behind
 * it, and the one that costs money only appears when the caddy genuinely
 * cannot plan a replacement for what is about to go.
 *
 * A hand-plotted course never reaches here: `tearOutNotice` answers null for
 * one, and the builder holds to the plain confirm it always had.
 */
export function TearOutSheet({
  open,
  onOpenChange,
  notice,
  courseName,
  pending,
  onConfirm,
  onMore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is true and which doors are open, decided in `lib/caddy/credits.ts`
   * so the sentence and the buttons cannot disagree. */
  notice: TearOutNotice;
  courseName: string;
  pending?: boolean;
  onConfirm: () => void;
  /** Opens the caddy's own money door. The parent owns both sheets so this one
   * closes as that one opens, rather than the two stacking — the house
   * arrangement, and the same one the round's rules and report sheets use. */
  onMore: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl">
        <SheetHeader className="pb-0 text-center">
          <SheetTitle className="eyebrow text-center text-fairway">
            Tear it out
          </SheetTitle>
          <SheetDescription className="font-serif text-xl text-foreground not-italic">
            {courseName}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-6">
          <p className="text-center text-xs text-hazard">{notice.line}</p>

          {/* Keeping it comes first, and it is the plain-language version of
              the decline: not "cancel" — what you get by not doing this. */}
          <Button
            className="mt-1 w-full"
            onClick={() => onOpenChange(false)}
            data-testid="keep-the-course"
          >
            {notice.canTweak ? "Keep it and tweak it" : "Keep it"}
          </Button>

          {/* Money, only where it answers something. A host who can still
              plan another course is not being refused anything and is not
              shown a price — the fee they already hold covers this. */}
          {notice.canReplace ? null : (
            <Button variant="outline" className="w-full" onClick={onMore}>
              Have the caddy plan more
            </Button>
          )}

          <div className="mt-3 border-t border-dotted border-border pt-3">
            <HoldToConfirm
              label="Hold to tear out of the book"
              holdingLabel="Keep holding — tearing it out"
              disabled={pending}
              onConfirm={onConfirm}
              data-testid="confirm-tear-out"
            />
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Tearing it out never touches a round already played on it.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
