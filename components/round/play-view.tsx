"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Flag, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Screen } from "@/components/shell/screen";
import { HoleStrip } from "@/components/round/hole-strip";
import { PenaltySheet } from "@/components/round/penalty-sheet";
import { penaltyOptions } from "@/lib/penalty-options";
import { PositionRibbon } from "@/components/round/position-ribbon";
import { TimerRing } from "@/components/round/timer-ring";
import { useLiveRound } from "@/components/round/use-live-round";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DotLeaderRow } from "@/components/ui/dot-leader";
import { Medallion } from "@/components/ui/medallion";
import { RuleDouble } from "@/components/ui/rule";
import { usePresence } from "@/hooks/use-presence";
import { advanceHole, resetHoleTimer, upsertScore } from "@/lib/actions/rounds";
import type { RoundBundle } from "@/lib/data/rounds";
import { underOverPhrase } from "@/lib/format";
import { computeStandings } from "@/lib/scoring";
import { cn } from "@/lib/utils";

export function PlayView({ bundle }: { bundle: RoundBundle }) {
  const { round, holes, players, scores, penalties, me } = bundle;
  useLiveRound(round.id);
  const { present, synced } = usePresence(round.id, me?.id ?? null);
  const [pending, startTransition] = useTransition();
  const [penaltySheetOpen, setPenaltySheetOpen] = useState(false);

  const hole = holes.find((h) => h.number === round.current_hole) ?? holes[0];
  const isOfficial = me != null && ["host", "caddy"].includes(me.role);

  const serverSwigs =
    scores.find(
      (score) =>
        score.player_id === me?.id && score.hole_number === round.current_hole,
    )?.swigs ?? 0;

  // Optimistic swig count, synced to the server behind a short debounce so
  // rapid taps become one upsert.
  const [swigs, setSwigs] = useState(serverSwigs);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holeRef = useRef(round.current_hole);
  const lastServer = useRef(serverSwigs);
  const syncing = useRef(false);
  useEffect(() => {
    // New hole (caddy advanced): reset the local counter to server state.
    if (holeRef.current !== round.current_hole) {
      holeRef.current = round.current_hole;
      lastServer.current = serverSwigs;
      setSwigs(serverSwigs);
      return;
    }
    // Someone else edited this card (marker's card): adopt the server value
    // unless the player is mid-tap with an upsert still in flight.
    if (serverSwigs !== lastServer.current) {
      lastServer.current = serverSwigs;
      if (!syncing.current) setSwigs(serverSwigs);
    }
  }, [round.current_hole, serverSwigs]);

  function changeSwigs(delta: number) {
    const next = Math.max(0, swigs + delta);
    setSwigs(next);
    syncing.current = true;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const result = await upsertScore(round.code, round.current_hole, next);
      syncing.current = false;
      lastServer.current = next;
      if (result.error) toast.error(result.error);
    }, 400);
  }

  function holeOut() {
    startTransition(async () => {
      const result = await advanceHole(round.code);
      if (result.error) toast.error(result.error);
    });
  }

  const ruleset = round.ruleset as {
    holeTimerMinutes?: number | null;
    softSubstituteScoresPar?: boolean;
    penalties?: { strokes: number; reason: string }[];
  };
  const standings = computeStandings(holes, players, scores, penalties, me?.id, {
    filedThrough: round.current_hole - 1,
    softSubstituteScoresPar: ruleset.softSubstituteScoresPar ?? true,
  });
  const myToPar = standings.find((row) => row.isYou)?.toPar ?? 0;
  const holeToPar = swigs - hole.par;
  const deadline = round.hole_deadline_at
    ? new Date(round.hole_deadline_at)
    : null;
  const options = penaltyOptions(ruleset.penalties);
  const myHolePenalties = penalties.filter(
    (row) =>
      row.player_id === me?.id && row.hole_number === round.current_hole,
  );

  return (
    <Screen>
      <RuleDouble />
      <HoleStrip
        holeNumbers={holes.map((h) => h.number)}
        currentHole={round.current_hole}
      />

      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Medallion>{hole.number}</Medallion>
          <div className="min-w-0">
            <div className="eyebrow text-fairway">
              Hole {round.current_hole} of {holes.length} · Par {hole.par}
            </div>
            <h1
              className="font-serif text-[22px] leading-tight italic"
              data-testid="hole-venue"
            >
              {hole.venue_name}
            </h1>
          </div>
        </div>
        {deadline && ruleset.holeTimerMinutes ? (
          <TimerRing
            deadline={deadline}
            totalMs={ruleset.holeTimerMinutes * 60_000}
          />
        ) : null}
      </header>

      <DotLeaderRow label={hole.drink} value={`par ${hole.par}`} />

      {hole.hazard ? (
        <div className="rounded-md border border-hazard border-l-4 bg-hazard/5 px-3 py-2 text-[11px] text-hazard">
          <b className="tracking-[0.14em] uppercase">{hole.hazard} hazard</b>
          {hole.hazard_note ? ` — ${hole.hazard_note}` : null}
        </div>
      ) : null}

      {/* The score: display only, engraved. The hands live in the thumb
          cluster below. */}
      <Card className="engraved gap-0 px-4 py-5 text-center">
        <div className="eyebrow mb-1">Your swigs</div>
        <span
          className="tabular font-serif text-6xl leading-none"
          data-testid="swig-count"
        >
          {swigs}
        </span>
        <div className="mt-2 text-xs font-bold text-muted-foreground">
          {underOverPhrase(holeToPar)} on the hole, {underOverPhrase(myToPar)}{" "}
          on the card
        </div>
      </Card>

      <PositionRibbon standings={standings} />

      {synced ? (
        <p className="tabular text-center font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
          {present.size} OF {players.length} ON THIS HOLE
        </p>
      ) : null}

      <div className="mt-auto flex flex-col gap-2.5">
        {isOfficial ? (
          <div className="flex items-center gap-2">
            <Link
              href={`/round/${round.code}/card`}
              className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border text-xs font-bold text-fairway"
            >
              Marker&apos;s card
            </Link>
            {deadline ? (
              <button
                type="button"
                disabled={pending}
                data-testid="reset-timer"
                onClick={() =>
                  startTransition(async () => {
                    const result = await resetHoleTimer(round.code);
                    if (result.error) toast.error(result.error);
                    else toast("Timer re-armed on every card.");
                  })
                }
                className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border text-xs font-bold disabled:opacity-40"
              >
                Reset timer
              </button>
            ) : null}
            <Button
              size="compact"
              className="flex-1"
              disabled={pending}
              onClick={holeOut}
              data-testid="hole-out"
            >
              Hole out
            </Button>
          </div>
        ) : (
          <p className="text-center text-[11px] text-muted-foreground">
            The caddy calls the hole — drink at your own pace.
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            aria-label="One swig fewer"
            data-testid="swig-minus"
            disabled={swigs === 0}
            onClick={() => changeSwigs(-1)}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-muted-foreground/60 text-sm font-bold text-muted-foreground disabled:opacity-40"
          >
            <Minus size={15} aria-hidden /> Undo a swig
          </button>
          <button
            type="button"
            onClick={() => setPenaltySheetOpen(true)}
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border-[1.5px] text-sm font-bold",
              myHolePenalties.length > 0
                ? "border-hazard bg-hazard/10 text-hazard"
                : "border-hazard/60 text-hazard",
            )}
          >
            <Flag size={14} aria-hidden />
            Penalties
            {myHolePenalties.length > 0 ? ` · ${myHolePenalties.length}` : ""}
          </button>
        </div>

        <button
          type="button"
          aria-label="One more swig"
          data-testid="swig-plus"
          onClick={() => changeSwigs(1)}
          className="flex min-h-20 flex-col items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25 active:brightness-95"
        >
          <span className="flex items-center gap-1 text-3xl leading-none font-extrabold">
            <Plus size={26} strokeWidth={3} aria-hidden /> 1
          </span>
          <span className="text-[10px] font-extrabold tracking-[0.2em]">
            SWIG
          </span>
        </button>
      </div>

      <PenaltySheet
        open={penaltySheetOpen}
        onOpenChange={setPenaltySheetOpen}
        code={round.code}
        holeNumber={round.current_hole}
        options={options}
        myPenalties={myHolePenalties}
      />
    </Screen>
  );
}
