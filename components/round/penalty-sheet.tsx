"use client";

import { Fragment, useOptimistic } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { LocalRulesHeading } from "@/components/round/local-rules-heading";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAction } from "@/hooks/use-action";
import { addPenalty, removeOwnPenalty } from "@/lib/actions/rounds";
import type { PenaltyOption } from "@/lib/penalty-options";
import type { Tables } from "@/types/supabase-helpers";
import { cn } from "@/lib/utils";

/** The ×N counts per reason, with the taps not yet on the server counted
 * in — the number moves the moment the thumb lands. */
function reasonCounts(rows: Tables<"penalties">[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  return counts;
}

/**
 * The penalties bottom sheet, self mode: call a penalty on your own card,
 * or undo a mis-tap. Every target is a full-size 44px circle — this is
 * the drunkest interaction in the app.
 *
 * The counts are optimistic; the undo only arms once the row it would
 * delete has really landed, so a mis-tap can never chase a ghost.
 */
export function PenaltySheet({
  open,
  onOpenChange,
  code,
  holeNumber,
  options,
  myPenalties,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  holeNumber: number;
  options: PenaltyOption[];
  /** The viewer's penalty rows for this hole. */
  myPenalties: Tables<"penalties">[];
}) {
  const { run } = useAction();
  const [counts, bump] = useOptimistic(
    reasonCounts(myPenalties),
    (state: Record<string, number>, delta: { reason: string; by: 1 | -1 }) => ({
      ...state,
      [delta.reason]: Math.max(0, (state[delta.reason] ?? 0) + delta.by),
    }),
  );

  function call(option: PenaltyOption) {
    run(async () => {
      bump({ reason: option.reason, by: 1 });
      const result = await addPenalty(
        code,
        holeNumber,
        option.strokes,
        option.reason,
      );
      if (!result.error) toast(`${option.label} — it's on the card.`);
      return result;
    });
  }

  function undo(option: PenaltyOption) {
    run(async () => {
      bump({ reason: option.reason, by: -1 });
      const result = await removeOwnPenalty(code, holeNumber, option.reason);
      if (!result.error) toast(`${option.label} taken off the card.`);
      return result;
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl">
        <SheetHeader className="pb-0 text-center">
          <SheetTitle className="eyebrow text-center text-foreground">
            On the card · Hole {holeNumber}
          </SheetTitle>
          <SheetDescription className="text-center text-xs">
            Penalties go on your own card. The caddy sees everything.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col px-4 pb-6">
          {options.map((option, index) => {
            const count = counts[option.reason] ?? 0;
            // Undo arms on the rows that have really landed — an optimistic
            // count has nothing on the server to delete yet.
            const landed = myPenalties.filter(
              (row) => row.reason === option.reason,
            ).length;
            const opensLocalRules =
              option.scope === "hole" && options[index - 1]?.scope !== "hole";
            return (
              <Fragment key={option.reason}>
                {opensLocalRules ? <LocalRulesHeading /> : null}
                <div
                  className={cn(
                    "flex min-h-14 items-center gap-3 py-1.5",
                    index > 0 &&
                      !opensLocalRules &&
                      "border-t border-dotted border-border",
                  )}
                >
                  <span className="tabular w-8 shrink-0 font-mono text-xs font-bold text-hazard">
                    +{option.strokes}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-sm">{option.label}</b>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {option.reason}
                      {count > 0 ? ` · on the card ×${count}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Undo ${option.label}`}
                    disabled={landed === 0}
                    onClick={() => undo(option)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-hazard/60 text-hazard disabled:opacity-25"
                  >
                    <Minus size={17} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Call ${option.label}`}
                    onClick={() => call(option)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-hazard bg-hazard/10 text-hazard disabled:opacity-25"
                  >
                    <Plus size={17} aria-hidden />
                  </button>
                </div>
              </Fragment>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
