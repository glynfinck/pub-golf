"use client";

import { Fragment, useOptimistic, useState } from "react";
import { Minus, Plus, UserRoundX } from "lucide-react";
import { toast } from "sonner";
import { LocalRulesHeading } from "@/components/round/local-rules-heading";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { PendingLabel } from "@/components/ui/pending-label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import { useAction } from "@/hooks/use-action";
import { useDraftFigures } from "@/hooks/use-draft-figures";
import {
  callPenaltyOn,
  removePenalty,
  setPlayerMulligans,
  strikeSeat,
} from "@/lib/actions/rounds";
import type { PenaltyOption } from "@/lib/penalty-options";
import { MAX_MULLIGANS } from "@/lib/rules";
import type { Tables } from "@/types/supabase-helpers";
import { cn } from "@/lib/utils";

/**
 * The marker's side of the penalty sheet: the caddy calls or retracts
 * penalties on one player's card. Every entry is attributed — "who called
 * it" is never a mystery on the player's own phone.
 *
 * Counts and the mulligan figure are optimistic; the retract only
 * arms once the row it would delete has really landed.
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
  mulligans,
  mulligansOffered,
  canStrike,
  scoredHoles,
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
  /** Mulligans on this player-hole, for the marker to correct. */
  mulligans: number;
  /** False when the round isn't playing them — then the row stays off. */
  mulligansOffered: boolean;
  /** Never the host seat, never the official's own card. */
  canStrike: boolean;
  /** Holes with swigs on this player's whole card — prices the confirm. */
  scoredHoles: number;
}) {
  const { run, pending, busy } = useAction();

  // Armed per player, so opening another card disarms it — and a close
  // does too: a half-armed confirm must not survive to the next open.
  const [strikeArmedFor, setStrikeArmedFor] = useState<string | null>(null);
  const strikeArmed = player !== null && strikeArmedFor === player.id;

  function handleOpenChange(next: boolean) {
    if (!next) setStrikeArmedFor(null);
    onOpenChange(next);
  }

  // Optimistic ×N per reason — the tap counts before the server does.
  const baseCounts: Record<string, number> = {};
  for (const row of playerPenalties)
    baseCounts[row.reason] = (baseCounts[row.reason] ?? 0) + 1;
  const [counts, bump] = useOptimistic(
    baseCounts,
    (state: Record<string, number>, delta: { reason: string; by: 1 | -1 }) => ({
      ...state,
      [delta.reason]: Math.max(0, (state[delta.reason] ?? 0) + delta.by),
    }),
  );

  // Optimistic mulligan figure, debounced like every other stepper.
  const figureKey = `${holeNumber}:${player?.id ?? "none"}`;
  const figures = useDraftFigures({
    server: { [figureKey]: mulligans },
    write: (_key, value) =>
      player
        ? setPlayerMulligans(code, player.id, holeNumber, value)
        : Promise.resolve(),
  });

  if (!player) return null;
  const name = player.display_name;

  function call(option: PenaltyOption) {
    if (!player) return;
    run(async () => {
      bump({ reason: option.reason, by: 1 });
      const result = await callPenaltyOn(
        code,
        player.id,
        holeNumber,
        option.strokes,
        option.reason,
      );
      if (!result.error) toast(`${option.label} — on ${name}'s card.`);
      return result;
    });
  }

  function retract(option: PenaltyOption) {
    const latest = [...playerPenalties]
      .filter((row) => row.reason === option.reason)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!latest) return;
    run(async () => {
      bump({ reason: option.reason, by: -1 });
      const result = await removePenalty(code, latest.id);
      if (!result.error) toast(`${option.label} taken off ${name}'s card.`);
      return result;
    });
  }

  function callerName(calledBy: string | null) {
    if (!calledBy || calledBy === player?.id) return null;
    return players.find((row) => row.id === calledBy)?.display_name ?? null;
  }

  function strike() {
    if (!player) return;
    run(async () => {
      const result = await strikeSeat(code, player.id);
      if (!result.error) {
        toast(`${name} struck from the round.`);
        setStrikeArmedFor(null);
        onOpenChange(false);
      }
      return result;
    });
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
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
            const count = counts[option.reason] ?? 0;
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
                      {count > 0
                        ? `On the card ×${count}${
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
                    disabled={rows.length === 0}
                    onClick={() => retract(option)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-hazard/60 text-hazard disabled:opacity-25"
                  >
                    <Minus size={17} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Call ${option.label} on ${name}`}
                    onClick={() => call(option)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-hazard bg-hazard/10 text-hazard disabled:opacity-25"
                  >
                    <Plus size={17} aria-hidden />
                  </button>
                </div>
              </Fragment>
            );
          })}

          {mulligansOffered ? (
            <div className="mt-2 flex min-h-14 items-center gap-3 border-t border-dotted border-border py-1.5">
              <span className="min-w-0 flex-1">
                <b className="block text-sm">Mulligans</b>
                <span
                  className={cn(
                    "block truncate text-[11px]",
                    figures.settling(figureKey)
                      ? "text-marker"
                      : "text-muted-foreground",
                  )}
                >
                  {figures.valueOf(figureKey) > 0
                    ? `${figures.valueOf(figureKey)} taken on this hole`
                    : "None taken on this hole"}
                </span>
              </span>
              <Stepper
                className="shrink-0"
                value={figures.valueOf(figureKey)}
                onChange={(next) => figures.set(figureKey, next)}
                max={MAX_MULLIGANS}
                tone="hazard"
                decrementLabel={`Take a mulligan off ${name} on hole ${holeNumber}`}
                incrementLabel={`Give ${name} a mulligan on hole ${holeNumber}`}
                label="mulligans"
              />
            </div>
          ) : null}

          {canStrike ? (
            <div className="mt-2 border-t border-dotted border-border pt-2">
              {strikeArmed ? (
                <div className="flex flex-col gap-2.5 rounded-xl border border-hazard/60 bg-card p-4">
                  <h3 className="font-serif text-base font-semibold text-hazard">
                    Strike {name} from the round?
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {scoredHoles > 0
                      ? `Their seat leaves the round and ${scoredHoles} scored ${
                          scoredHoles === 1 ? "hole goes" : "holes go"
                        } with it. Penalties they called on other cards stay.`
                      : "Nothing is on their card yet — the seat just leaves the round. They can knock to come back any time."}
                  </p>
                  <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() => setStrikeArmedFor(null)}
                    >
                      Keep them
                    </Button>
                    {scoredHoles > 0 ? (
                      <HoldToConfirm
                        label="Hold to strike"
                        holdingLabel="Hold…"
                        disabled={pending}
                        onConfirm={strike}
                        data-testid="strike-seat-confirm"
                      />
                    ) : (
                      <Button
                        variant="destructive"
                        disabled={pending}
                        data-testid="strike-seat-confirm"
                        onClick={strike}
                      >
                        <PendingLabel
                          pending={pending}
                          busy={busy}
                          label="Strike the seat"
                          pendingLabel="Striking the seat"
                        />
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="strike-seat"
                  onClick={() => setStrikeArmedFor(player.id)}
                  className="group flex min-h-12 w-full items-center gap-3 py-1.5 text-left focus-visible:outline-none"
                >
                  <UserRoundX size={17} aria-hidden className="shrink-0 text-hazard" />
                  <span className="min-w-0 flex-1">
                    <b className="block text-sm text-hazard">
                      Strike from the round
                    </b>
                    <span className="block text-[11px] text-muted-foreground">
                      For the duplicate a lost session left behind — their
                      scores go with the seat
                    </span>
                  </span>
                </button>
              )}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
