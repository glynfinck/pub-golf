"use client";

import { useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { addPenalty, removeOwnPenalty } from "@/lib/actions/rounds";
import { QUICK_PENALTIES } from "@/lib/rules";
import type { Tables } from "@/types/supabase-helpers";
import { cn } from "@/lib/utils";

export interface PenaltyOption {
  label: string;
  strokes: number;
  reason: string;
}

/** QUICK_PENALTIES first (their labels are the house shorthand), then any
 * extra presets this round's ruleset carries, keyed by reason. */
export function penaltyOptions(
  rulesetPenalties: { strokes: number; reason: string }[] | undefined,
): PenaltyOption[] {
  const options: PenaltyOption[] = [...QUICK_PENALTIES];
  const known = new Set(options.map((option) => option.reason));
  for (const preset of rulesetPenalties ?? []) {
    if (known.has(preset.reason)) continue;
    known.add(preset.reason);
    options.push({
      label: `${preset.reason.split(/[—,]/)[0].trim()} +${preset.strokes}`,
      strokes: preset.strokes,
      reason: preset.reason,
    });
  }
  return options;
}

/**
 * The penalties bottom sheet, self mode: call a penalty on your own card,
 * or undo a mis-tap. Every target is a full-size 44px circle — this is
 * the drunkest interaction in the app.
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
  const [pending, startTransition] = useTransition();

  function call(option: PenaltyOption) {
    startTransition(async () => {
      const result = await addPenalty(
        code,
        holeNumber,
        option.strokes,
        option.reason,
      );
      if (result.error) toast.error(result.error);
      else toast(`${option.label} — it's on the card.`);
    });
  }

  function undo(option: PenaltyOption) {
    startTransition(async () => {
      const result = await removeOwnPenalty(code, holeNumber, option.reason);
      if (result.error) toast.error(result.error);
      else toast(`${option.label} taken off the card.`);
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
            const count = myPenalties.filter(
              (row) => row.reason === option.reason,
            ).length;
            return (
              <div
                key={option.reason}
                className={cn(
                  "flex min-h-14 items-center gap-3 py-1.5",
                  index > 0 && "border-t border-dotted border-border",
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
                  disabled={pending || count === 0}
                  onClick={() => undo(option)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-hazard/60 text-hazard disabled:opacity-25"
                >
                  <Minus size={17} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Call ${option.label}`}
                  disabled={pending}
                  onClick={() => call(option)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-hazard bg-hazard/10 text-hazard disabled:opacity-25"
                >
                  <Plus size={17} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
