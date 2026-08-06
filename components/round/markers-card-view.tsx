"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronRight, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { HoleStrip } from "@/components/round/hole-strip";
import { MarkerPlayerSheet } from "@/components/round/marker-player-sheet";
import { penaltyOptions } from "@/components/round/penalty-sheet";
import { useLiveRound } from "@/components/round/use-live-round";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RuleDouble } from "@/components/ui/rule";
import { reopenHole, setPlayerScore } from "@/lib/actions/rounds";
import type { RoundBundle } from "@/lib/data/rounds";
import { cn, formatToPar } from "@/lib/utils";

/**
 * The marker's card, with roam: the caddy reviews and edits ANY hole via
 * the strip without moving the round. The one action that moves everyone
 * — reopening a hole — is explicit and hazard-red.
 */
export function MarkersCardView({
  bundle,
  viewedHole,
}: {
  bundle: RoundBundle;
  viewedHole: number;
}) {
  const { round, holes, players, scores, penalties } = bundle;
  useLiveRound(round.id);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sheetPlayerId, setSheetPlayerId] = useState<string | null>(null);

  const hole = holes.find((h) => h.number === viewedHole) ?? holes[0];
  const roaming =
    round.status === "finished" || viewedHole !== round.current_hole;
  const ruleset = round.ruleset as {
    penalties?: { strokes: number; reason: string }[];
  };
  const options = penaltyOptions(ruleset.penalties);
  const sheetPlayer =
    players.find((player) => player.id === sheetPlayerId) ?? null;

  function swigsFor(playerId: string) {
    return (
      scores.find(
        (score) =>
          score.player_id === playerId && score.hole_number === viewedHole,
      )?.swigs ?? 0
    );
  }

  function adjust(playerId: string, delta: number) {
    const next = Math.max(0, swigsFor(playerId) + delta);
    startTransition(async () => {
      const result = await setPlayerScore(round.code, playerId, viewedHole, next);
      if (result.error) toast.error(result.error);
    });
  }

  function viewHole(n: number) {
    router.replace(
      n === round.current_hole
        ? `/round/${round.code}/card`
        : `/round/${round.code}/card?hole=${n}`,
      { scroll: false },
    );
  }

  function reopen() {
    startTransition(async () => {
      const result = await reopenHole(round.code, viewedHole);
      if (result.error) toast.error(result.error);
      else router.push(`/round/${round.code}/play`);
    });
  }

  const backHref =
    round.status === "finished"
      ? `/round/${round.code}/results`
      : `/round/${round.code}/play`;

  return (
    <Screen>
      <RuleDouble />
      <ScreenHeader
        eyebrow={`Caddy · ${roaming ? "reviewing" : "hole"} ${viewedHole}`}
        title="The marker's card"
        action={
          <Link href={backHref} className="text-xs font-bold text-fairway">
            Back to play
          </Link>
        }
      />

      <HoleStrip
        holeNumbers={holes.map((h) => h.number)}
        currentHole={round.status === "finished" ? 0 : round.current_hole}
        viewingHole={viewedHole}
        onSelect={viewHole}
      />

      <div className="text-sm">
        <span className="font-serif italic">{hole.venue_name}</span>
        <span className="text-muted-foreground">
          {" "}
          · par {hole.par} · {hole.drink}
        </span>
      </div>

      {roaming && round.status !== "finished" ? (
        <div
          data-testid="roaming-banner"
          className="rounded-lg border border-marker bg-marker/10 px-3 py-2 text-[11px] text-marker"
        >
          Reviewing the record — the round stays live on hole{" "}
          {round.current_hole}. Nobody moves; totals update everywhere.
        </div>
      ) : null}

      <Card className="gap-0 px-4 py-1">
        {players.map((player, index) => {
          const swigs = swigsFor(player.id);
          const holePenalties = penalties.filter(
            (row) =>
              row.player_id === player.id && row.hole_number === viewedHole,
          );
          const penaltyStrokes = holePenalties.reduce(
            (sum, row) => sum + row.strokes,
            0,
          );
          const delta = swigs + penaltyStrokes - hole.par;
          return (
            <div
              key={player.id}
              className={cn(
                "flex min-h-13 items-center gap-2",
                index > 0 && "border-t border-border",
              )}
            >
              <button
                type="button"
                aria-label={`Open ${player.display_name}'s card`}
                onClick={() => setSheetPlayerId(player.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left"
              >
                <Avatar
                  name={player.display_name}
                  className="size-7 text-[10px]"
                />
                <span className="min-w-0">
                  <b className="block truncate text-sm">
                    {player.display_name}
                  </b>
                  <span
                    className={cn(
                      "block text-[10px]",
                      penaltyStrokes > 0
                        ? "text-hazard"
                        : "text-muted-foreground",
                    )}
                  >
                    {penaltyStrokes > 0
                      ? `+${penaltyStrokes} in penalties`
                      : swigs === 0
                        ? "no swigs — scores the substitute"
                        : formatToPar(delta)}
                  </span>
                </span>
                <ChevronRight
                  size={14}
                  aria-hidden
                  className="ml-0.5 shrink-0 text-muted-foreground"
                />
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={`Fewer swigs for ${player.display_name} on hole ${viewedHole}`}
                  disabled={pending || swigs === 0}
                  onClick={() => adjust(player.id, -1)}
                  className="flex size-9 items-center justify-center rounded-full border-[1.5px] border-border text-muted-foreground disabled:opacity-30"
                >
                  <Minus size={15} aria-hidden />
                </button>
                <span className="tabular min-w-6 text-center font-serif text-xl">
                  {swigs}
                </span>
                <button
                  type="button"
                  aria-label={`More swigs for ${player.display_name} on hole ${viewedHole}`}
                  disabled={pending}
                  onClick={() => adjust(player.id, 1)}
                  className="flex size-9 items-center justify-center rounded-full border-[1.5px] border-good text-good disabled:opacity-30"
                >
                  <Plus size={15} aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </Card>

      <p className="text-center text-[11px] text-muted-foreground">
        Swigs inline · tap a player for their penalties · edits land on every
        phone in under a second.
      </p>

      <div className="mt-auto flex flex-col gap-2">
        {roaming ? (
          <>
            <button
              type="button"
              data-testid="reopen-hole"
              disabled={pending}
              onClick={reopen}
              className="flex min-h-12 items-center justify-center rounded-xl border-[1.5px] border-hazard text-sm font-bold text-hazard disabled:opacity-40"
            >
              Reopen hole {viewedHole} for everyone
            </button>
            {round.status !== "finished" ? (
              <Button onClick={() => viewHole(round.current_hole)}>
                Back to the live hole → {round.current_hole}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>

      <MarkerPlayerSheet
        open={sheetPlayer !== null}
        onOpenChange={(open) => {
          if (!open) setSheetPlayerId(null);
        }}
        code={round.code}
        holeNumber={viewedHole}
        player={sheetPlayer}
        playerPenalties={penalties.filter(
          (row) =>
            row.player_id === sheetPlayerId && row.hole_number === viewedHole,
        )}
        players={players}
        options={options}
      />
    </Screen>
  );
}
