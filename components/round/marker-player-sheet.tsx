"use client";

import { Fragment, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { LocalRulesHeading } from "@/components/round/local-rules-heading";
import { Avatar } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import {
  callPenaltyOn,
  removePenalty,
  setPlayerBreakfastBalls,
} from "@/lib/actions/rounds";
import type { PenaltyOption } from "@/lib/penalty-options";
import { MAX_BREAKFAST_BALLS } from "@/lib/rules";
import type { Tables } from "@/types/supabase-helpers";
import { cn } from "@/lib/utils";

/**
 * The marker's side of the penalty sheet: the caddy calls or retracts
 * penalties on one player's card. Every entry is attributed — "who called
 * it" is never a mystery on the player's own phone.
 */
export function MarkerPlayerSheet({
  open,
  onOpenChange,
  code,
  holeNumber,
  player,
  playerPenalties,
  players,
  options,
  breakfastBalls,
  breakfastBallsOffered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  holeNumber: number;
  player: Tables<"round_players"> | null;
  /** The target player's penalty rows for this hole. */
  playerPenalties: Tables<"penalties">[];
  /** All players, for attributing called_by ids to names. */
  players: Tables<"round_players">[];
  options: PenaltyOption[];
  /** Breakfast balls on this player-hole, for the marker to correct. */
  breakfastBalls: number;
  /** False when the round isn't playing them — then the row stays off. */
  breakfastBallsOffered: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (!player) return null;
  const name = player.display_name;

  function call(option: PenaltyOption) {
    if (!player) return;
    startTransition(async () => {
      const result = await callPenaltyOn(
        code,
        player.id,
        holeNumber,
        option.strokes,
        option.reason,
      );
      if (result.error) toast.error(result.error);
      else toast(`${option.label} — on ${name}'s card.`);
    });
  }

  function retract(option: PenaltyOption) {
    const latest = [...playerPenalties]
      .filter((row) => row.reason === option.reason)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!latest) return;
    startTransition(async () => {
      const result = await removePenalty(code, latest.id);
      if (result.error) toast.error(result.error);
      else toast(`${option.label} taken off ${name}'s card.`);
    });
  }

  function correctBreakfastBalls(next: number) {
    if (!player) return;
    startTransition(async () => {
      const result = await setPlayerBreakfastBalls(
        code,
        player.id,
        holeNumber,
        next,
      );
      if (result.error) toast.error(result.error);
    });
  }

  function callerName(calledBy: string | null) {
    if (!calledBy || calledBy === player?.id) return null;
    return players.find((row) => row.id === calledBy)?.display_name ?? null;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-2xl">
        <SheetHeader className="pb-0">
          <SheetTitle className="flex items-center justify-center gap-2 text-base">
            <Avatar name={name} className="size-7 text-[11px]" />
            {name}&apos;s card · Hole {holeNumber}
          </SheetTitle>
          <SheetDescription className="text-center text-xs">
            Marker&apos;s entries are stamped &ldquo;by the caddy&rdquo; on{" "}
            {name}&apos;s phone.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col px-4 pb-6">
          {options.map((option, index) => {
            const rows = playerPenalties.filter(
              (row) => row.reason === option.reason,
            );
            const attributed = rows
              .map((row) => callerName(row.called_by))
              .filter(Boolean);
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
                      {rows.length > 0
                        ? `On the card ×${rows.length}${
                            attributed.length > 0
                              ? ` · by ${attributed.join(", ")}`
                              : ""
                          }`
                        : option.reason}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Retract ${option.label} from ${name}`}
                    disabled={pending || rows.length === 0}
                    onClick={() => retract(option)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-hazard/60 text-hazard disabled:opacity-25"
                  >
                    <Minus size={17} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Call ${option.label} on ${name}`}
                    disabled={pending}
                    onClick={() => call(option)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-hazard bg-hazard/10 text-hazard disabled:opacity-25"
                  >
                    <Plus size={17} aria-hidden />
                  </button>
                </div>
              </Fragment>
            );
          })}

          {breakfastBallsOffered ? (
            <div className="mt-2 flex min-h-14 items-center gap-3 border-t border-dotted border-border py-1.5">
              <span className="min-w-0 flex-1">
                <b className="block text-sm">Breakfast balls</b>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {breakfastBalls > 0
                    ? `${breakfastBalls} taken on this hole`
                    : "None taken on this hole"}
                </span>
              </span>
              <Stepper
                className="w-28 shrink-0"
                value={breakfastBalls}
                onChange={correctBreakfastBalls}
                max={MAX_BREAKFAST_BALLS}
                disabled={pending}
                tone="hazard"
                decrementLabel={`Take a breakfast ball off ${name} on hole ${holeNumber}`}
                incrementLabel={`Give ${name} a breakfast ball on hole ${holeNumber}`}
                label="breakfast balls"
              />
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
