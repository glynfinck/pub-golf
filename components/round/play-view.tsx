"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Flag, Minus, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Screen } from "@/components/shell/screen";
import { MulliganSheet } from "@/components/round/mulligan-sheet";
import { HoleStrip } from "@/components/round/hole-strip";
import { PenaltySheet } from "@/components/round/penalty-sheet";
import { penaltyOptions } from "@/lib/penalty-options";
import { PositionRibbon } from "@/components/round/position-ribbon";
import { RoundBar } from "@/components/round/round-bar";
import { TimerRing } from "@/components/round/timer-ring";
import { useLiveRound } from "@/components/round/use-live-round";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DotLeaderRow } from "@/components/ui/dot-leader";
import { Medallion } from "@/components/ui/medallion";
import { PendingLabel } from "@/components/ui/pending-label";
import { useAction } from "@/hooks/use-action";
import { usePresence } from "@/hooks/use-presence";
import {
  advanceHole,
  resetHoleTimer,
  takeMulligan,
  upsertScore,
} from "@/lib/actions/rounds";
import type { RoundBundle } from "@/lib/data/rounds";
import { RulesSheet } from "@/components/round/rules-sheet";
import { underOverPhrase } from "@/lib/format";
import { roundRuleChips } from "@/lib/round-rules";
import { readHolePenalties, readRuleset } from "@/lib/ruleset";
import { computeStandings } from "@/lib/scoring";
import { cn } from "@/lib/utils";

export function PlayView({ bundle }: { bundle: RoundBundle }) {
  const { round, holes, players, scores, penalties, me } = bundle;
  useLiveRound(round.id);
  const { present, synced } = usePresence(round.id, me?.id ?? null);
  const { run, pending, busy } = useAction();
  const [penaltySheetOpen, setPenaltySheetOpen] = useState(false);
  const [mulliganOpen, setMulliganOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

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
  /** The swig write currently on its way to the server, if any. */
  const inFlight = useRef<Promise<void> | null>(null);
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
    debounce.current = setTimeout(() => {
      // Held so a mulligan can wait this out — see takeHalfPint.
      inFlight.current = upsertScore(round.code, round.current_hole, next)
        .then((result) => {
          lastServer.current = next;
          if (result.error) toast.error(result.error);
        })
        .finally(() => {
          syncing.current = false;
          inFlight.current = null;
        });
    }, 400);
  }

  /**
   * Take a mulligan: wipe the hole and drink a half.
   *
   * The debounce is the whole difficulty. Swigs are written 400ms after the
   * last tap, so "tap, tap, tap, ugh, half pint" leaves a write in the post
   * that lands AFTER the reset and puts the wiped swigs straight back on the
   * card — and `syncing` would still be true, so the screen would refuse the
   * server's zero as well. Drop the write that has not left yet, wait out one
   * that has, and only then reset.
   */
  function takeHalfPint() {
    run(async () => {
      clearTimeout(debounce.current);
      await inFlight.current;
      syncing.current = false;

      const result = await takeMulligan(round.code, round.current_hole);
      if (result.error) return result;
      setSwigs(0);
      lastServer.current = 0;
      setMulliganOpen(false);
      toast("Mulligan taken — start the hole again.");
    });
  }

  function holeOut() {
    run(() => advanceHole(round.code));
  }

  const ruleset = readRuleset(round.ruleset);
  const standings = computeStandings(holes, players, scores, penalties, me?.id, {
    filedThrough: round.current_hole - 1,
    softSubstituteScoresPar: ruleset.softSubstituteScoresPar,
    mulliganStrokes: ruleset.mulliganStrokes,
  });
  const myRow = standings.find((row) => row.isYou);
  const myToPar = myRow?.netToPar ?? 0;
  const holeToPar = swigs - hole.par;
  const deadline = round.hole_deadline_at
    ? new Date(round.hole_deadline_at)
    : null;
  const options = penaltyOptions(
    ruleset.penalties,
    readHolePenalties(hole.penalties),
  );
  const myHolePenalties = penalties.filter(
    (row) =>
      row.player_id === me?.id && row.hole_number === round.current_hole,
  );

  const ruleChips = roundRuleChips(ruleset, holes);

  // Mulligans are an allowance for the whole round, so what's left is a
  // count across every hole on the card, not just this one.
  const mulligansUsed = scores
    .filter((score) => score.player_id === me?.id)
    .reduce((sum, score) => sum + score.mulligans, 0);
  const mulligansLeft = Math.max(
    0,
    ruleset.mulligans - mulligansUsed,
  );

  return (
    <Screen>
      <RoundBar
        round={round}
        holes={holes}
        hole={round.current_hole}
        busy={busy}
      />
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

      {/* The rules in force, at a glance — chips, not sentences. The whole
          row is a second door onto the rules sheet the masthead's ? opens. */}
      {ruleChips.length > 0 ? (
        <button
          type="button"
          data-testid="rule-chips"
          aria-label="This round's rules"
          onClick={() => setRulesOpen(true)}
          className="-mt-1 flex flex-wrap items-center gap-1.5"
        >
          {ruleChips.map((chip) => (
            <span
              key={chip.id}
              className="rounded-full border border-border px-2 py-0.5 text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
            >
              {chip.label}
            </span>
          ))}
        </button>
      ) : null}

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
                // No success toast: the ring sweeping back to full IS the
                // confirmation, and it's the one every player gets.
                onClick={() => run(() => resetHoleTimer(round.code))}
                className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-border text-xs font-bold disabled:opacity-40"
              >
                <PendingLabel
                  pending={pending}
                  busy={busy}
                  putt={false}
                  label="Reset timer"
                  pendingLabel="Re-arming…"
                />
              </button>
            ) : null}
            <Button
              size="compact"
              className="flex-1"
              disabled={pending}
              onClick={holeOut}
              data-testid="hole-out"
            >
              <PendingLabel
                pending={pending}
                busy={busy}
                putt={false}
                label="Hole out"
                pendingLabel={
                  round.current_hole >= holes.length
                    ? "Filing the card…"
                    : `Filing hole ${round.current_hole}…`
                }
              />
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
            <Minus size={15} aria-hidden /> Undo
          </button>
          {/* Stacked like the SWIG button so the long word can never wrap
              a three-button row on a narrow phone: the label rides small
              caps on top, the private count is pips underneath — filled
              still in the pocket, hollow spent. */}
          {ruleset.mulligans > 0 ? (
            <button
              type="button"
              data-testid="mulligan"
              disabled={mulligansLeft === 0}
              onClick={() => setMulliganOpen(true)}
              aria-label={`Take a mulligan — ${mulligansLeft} of ${ruleset.mulligans} left`}
              className="flex min-h-11 flex-1 flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-marker/60 text-marker disabled:opacity-30"
            >
              <span className="flex items-center gap-1 text-[10px] font-extrabold tracking-[0.14em]">
                <RotateCcw size={11} aria-hidden />
                MULLIGAN
              </span>
              <span className="flex items-center gap-1" aria-hidden>
                {Array.from({ length: ruleset.mulligans }, (_, pip) => (
                  <span
                    key={pip}
                    className={cn(
                      "size-1.5 rounded-full",
                      pip < mulligansLeft
                        ? "bg-marker"
                        : "border border-marker/50",
                    )}
                  />
                ))}
              </span>
            </button>
          ) : null}
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

      <RulesSheet
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        round={round}
        holes={holes}
        hole={round.current_hole}
      />

      <MulliganSheet
        open={mulliganOpen}
        onOpenChange={setMulliganOpen}
        onConfirm={takeHalfPint}
        pending={pending}
        busy={busy}
        holeNumber={round.current_hole}
        swigs={swigs}
        strokes={ruleset.mulliganStrokes}
        left={mulligansLeft}
      />
    </Screen>
  );
}
