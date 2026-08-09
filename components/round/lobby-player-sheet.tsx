"use client";

import { ChevronLeft, ChevronRight, UserRoundX } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Stepper } from "@/components/ui/stepper";
import type { useDraftFigures } from "@/hooks/use-draft-figures";
import { MAX_HANDICAP } from "@/lib/rules";
import type { Tables } from "@/types/supabase-helpers";
import { cn } from "@/lib/utils";

/**
 * The lobby's adjust sheet: everything the officials can do to one guest
 * before the first tee — the caddy's card, the handicap — at full thumb
 * size, behind the row instead of crowding it. The ‹ › walk the field so
 * setting up a whole table is one open and a stroll, not a sheet per
 * guest.
 */
export function LobbyPlayerSheet({
  open,
  player,
  onOpenChange,
  canStep,
  onStep,
  showRoleToggle,
  onToggleCaddy,
  showStrike,
  onStrike,
  pending,
  handicapsOn,
  handicaps,
}: {
  open: boolean;
  /** The guest being adjusted; null keeps the sheet closed. */
  player: Tables<"round_players"> | null;
  onOpenChange: (open: boolean) => void;
  /** More than one adjustable guest — show the ‹ › walk. */
  canStep: boolean;
  onStep: (delta: 1 | -1) => void;
  /** Hosts see the caddy toggle on anyone but themselves. */
  showRoleToggle: boolean;
  onToggleCaddy: () => void;
  /** Officials see the strike on any guest but the host and themselves. */
  showStrike: boolean;
  onStrike: () => void;
  pending: boolean;
  handicapsOn: boolean;
  /** The lobby's shared draft figures — rows and sheet move together. */
  handicaps: ReturnType<typeof useDraftFigures>;
}) {
  // Armed per guest, so the ‹ › walk disarms it — and a close does too:
  // a half-armed confirm must not survive to the next open.
  const [strikeArmedFor, setStrikeArmedFor] = useState<string | null>(null);

  if (!player) return null;
  const name = player.display_name;
  const strikeArmed = strikeArmedFor === player.id;

  function handleOpenChange(next: boolean) {
    if (!next) setStrikeArmedFor(null);
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md rounded-t-2xl"
        data-testid="lobby-player-sheet"
      >
        <SheetHeader className="pb-0">
          <div className="flex items-center justify-between gap-3">
            {canStep ? (
              <button
                type="button"
                aria-label="Previous guest"
                onClick={() => onStep(-1)}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-input bg-card text-muted-foreground hover:bg-secondary"
              >
                <ChevronLeft size={17} aria-hidden />
              </button>
            ) : (
              <span aria-hidden className="size-11 shrink-0" />
            )}
            <div className="min-w-0 text-center">
              <span className="eyebrow block">Adjust</span>
              <SheetTitle className="truncate">{name}</SheetTitle>
            </div>
            {canStep ? (
              <button
                type="button"
                aria-label="Next guest"
                onClick={() => onStep(1)}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-input bg-card text-muted-foreground hover:bg-secondary"
              >
                <ChevronRight size={17} aria-hidden />
              </button>
            ) : (
              <span aria-hidden className="size-11 shrink-0" />
            )}
          </div>
          <SheetDescription className="text-center text-xs">
            Roles and shots settle before the first tee.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {showRoleToggle ? (
            <Chip
              active={player.role === "caddy"}
              disabled={pending}
              onClick={onToggleCaddy}
              className="min-h-12 w-full"
            >
              Caddy · stays sober, final word
            </Chip>
          ) : null}

          {handicapsOn ? (
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(
                  "eyebrow",
                  handicaps.settling(player.id) && "text-marker",
                )}
              >
                Handicap
              </span>
              <Stepper
                value={handicaps.valueOf(player.id)}
                onChange={(next) => handicaps.set(player.id, next)}
                max={MAX_HANDICAP}
                decrementLabel={`Lower ${name}'s handicap`}
                incrementLabel={`Raise ${name}'s handicap`}
                label="handicap"
              />
            </div>
          ) : null}

          {showStrike ? (
            strikeArmed ? (
              <div className="flex flex-col gap-2.5 rounded-xl border border-hazard/60 bg-card p-4">
                <h3 className="font-serif text-base font-semibold text-hazard">
                  Strike {name} from the round?
                </h3>
                <p className="text-xs text-muted-foreground">
                  Nothing has teed off — their seat just leaves the lobby, and
                  they can knock to come back any time.
                </p>
                <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => setStrikeArmedFor(null)}
                  >
                    Keep them
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={pending}
                    data-testid="strike-seat-confirm"
                    onClick={onStrike}
                  >
                    Strike the seat
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-testid="strike-seat"
                onClick={() => setStrikeArmedFor(player.id)}
                className="flex min-h-12 w-full items-center gap-3 text-left focus-visible:outline-none"
              >
                <UserRoundX
                  size={17}
                  aria-hidden
                  className="shrink-0 text-hazard"
                />
                <span className="min-w-0 flex-1">
                  <b className="block text-sm text-hazard">
                    Strike from the round
                  </b>
                  <span className="block text-[11px] text-muted-foreground">
                    For a duplicate join or a wrong number
                  </span>
                </span>
              </button>
            )
          ) : null}

          <SheetClose asChild>
            <Button variant="secondary">Done</Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
