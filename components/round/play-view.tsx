"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Flag, Minus, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Screen } from "@/components/shell/screen";
import { MulliganSheet } from "@/components/round/mulligan-sheet";
import { HoleStrip } from "@/components/round/hole-strip";
import { PenaltySheet } from "@/components/round/penalty-sheet";
import { actionNavigating } from "@/lib/action-window";
import { penaltyOptions } from "@/lib/penalty-options";
import { PositionRibbon } from "@/components/round/position-ribbon";
import { RescueKnock } from "@/components/round/rescue-knock";
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
import { readHazard } from "@/lib/hazards";
import { roundRuleChips } from "@/lib/round-rules";
import { readHolePenalties, readRuleset } from "@/lib/ruleset";
import { computeStandings } from "@/lib/scoring";
import { cn } from "@/lib/utils";

export function PlayView({ bundle }: { bundle: RoundBundle }) {
  const { round, holes, players, scores, penalties, me } = bundle;
  const router = useRouter();
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
  // Tap handlers read this mirror, never the render's copy: on a slow main
  // thread (WebKit mid-round) two taps can dispatch before React re-renders
  // between them, and both reading the same stale `swigs` collapses two
  // swigs into one — on screen and in the write that follows.
  const latestSwigs = useRef(serverSwigs);
  const syncing = useRef(false);
  /** The swig write currently on its way to the server, if any. */
  const inFlight = useRef<Promise<void> | null>(null);
  /** The swig write still waiting on the debounce, if any. */
  const pendingWrite = useRef<{ hole: number; swigs: number } | null>(null);
  useEffect(() => {
    // New hole (caddy advanced): reset the local counter to server state.
    if (holeRef.current !== round.current_hole) {
      holeRef.current = round.current_hole;
      lastServer.current = serverSwigs;
      latestSwigs.current = serverSwigs;
      setSwigs(serverSwigs);
      return;
    }
    // Someone else edited this card (marker's card): adopt the server value
    // unless the player is mid-tap with an upsert still in flight.
    if (serverSwigs !== lastServer.current) {
      lastServer.current = serverSwigs;
      if (!syncing.current) {
        latestSwigs.current = serverSwigs;
        setSwigs(serverSwigs);
      }
    }
  }, [round.current_hole, serverSwigs]);

  /** Send whatever the debounce is still holding, now. */
  const flushSwigs = useCallback(() => {
    const write = pendingWrite.current;
    if (!write) return;
    pendingWrite.current = null;
    // Held so a mulligan can wait this out — see takeHalfPint.
    inFlight.current = upsertScore(round.code, write.hole, write.swigs)
      .then((result) => {
        lastServer.current = write.swigs;
        if (result.error) toast.error(result.error);
      })
      .finally(() => {
        syncing.current = false;
        inFlight.current = null;
      });
  }, [round.code]);

  // The debounce must never be the reason a swig is lost. When this screen
  // goes away mid-window — the caddy holes out and every phone moves on,
  // or the phone pockets — send what is pending rather than trusting a
  // 400ms timer to survive the teardown. Same write, same guard: the
  // one-hole grace exists for exactly this tap.
  useEffect(() => {
    const flush = () => {
      clearTimeout(debounce.current);
      flushSwigs();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flushSwigs]);

  /**
   * The card has been filed and this screen has to go — but it may still be
   * holding the last swig of the last hole behind the 400ms debounce, and
   * leaving first abandons that write mid-flight. The player then scores the
   * par substitute for a drink they actually took, the forfeit lands on the
   * wrong person, and nothing on screen ever says so.
   *
   * The mulligan has the same problem pointing the other way and answers it
   * the same way round: takeHalfPint drops the write that has not left and
   * waits out the one that has. Here the write must not be dropped, so send
   * it, watch it land, and only then leave. `finally`, not `then` — a write
   * the guard refuses still has to let go of the screen, and the poll's own
   * refresh is still underneath this as the fallback.
   */
  const leaveForResults = useCallback(() => {
    clearTimeout(debounce.current);
    flushSwigs();
    void Promise.resolve(inFlight.current).finally(() => {
      actionNavigating(Date.now());
      router.replace(`/round/${round.code}/results`);
    });
  }, [flushSwigs, round.code, router]);

  // Deliberately after the flush plumbing above: this fires the moment the
  // rounds event says the round is over, and it must have a write to wait on.
  useLiveRound(round.id, { onRoundFinished: leaveForResults });

  function changeSwigs(delta: number) {
    const next = Math.max(0, latestSwigs.current + delta);
    latestSwigs.current = next;
    setSwigs(next);
    syncing.current = true;
    pendingWrite.current = { hole: round.current_hole, swigs: next };
    clearTimeout(debounce.current);
    debounce.current = setTimeout(flushSwigs, 400);
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
      pendingWrite.current = null;
      await inFlight.current;
      syncing.current = false;

      const result = await takeMulligan(round.code, round.current_hole);
      if (result.error) return result;
      latestSwigs.current = 0;
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

  // Every control in the thumb cluster is ONE geometry: a 44px target, one
  // corner, one border weight, one type scale, one line of label. Tone is
  // the only thing a control may vary.
  //
  // `min-w-0` is the load-bearing half. `flex-1` sets an equal basis but
  // leaves min-width:auto, so a track never shrinks below its own content —
  // and the widest content in this row is text nobody can see, because
  // PendingLabel measures the pending copy in the same grid cell as the
  // resting one. "Hole out" carrying "Filing hole 12…" under it — and
  // whitespace-nowrap off Button's base, so it could not even wrap the way
  // its neighbours did — sat 20px wider than them at every phone width.
  //
  // whitespace-nowrap is now deliberate and on all three, one line each, so
  // no control can outgrow the row vertically either; overflow-hidden is the
  // backstop, because below ~344px a track is narrower than its own label and
  // a word clipped inside the corner beats a row knocked out of true.
  const clusterControl =
    "flex min-h-11 flex-1 min-w-0 items-center justify-center gap-1.5 " +
    "overflow-hidden rounded-xl border-[1.5px] px-1.5 text-xs font-bold " +
    "whitespace-nowrap";

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

      <RescueKnock code={round.code} players={players} me={me} />

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

      {/* The hole's own note is the local wording; without one the hazard
          still has to say what it does, or a hand-built course shows a
          player the word "DOGLEG" and nothing else. */}
      {hole.hazard ? (
        <div className="rounded-md border border-hazard border-l-4 bg-hazard/5 px-3 py-2 text-[11px] text-hazard">
          <b className="tracking-[0.14em] uppercase">{hole.hazard} hazard</b>
          {hole.hazard_note
            ? ` — ${hole.hazard_note}`
            : readHazard(hole.hazard)
              ? ` — ${readHazard(hole.hazard)!.meaning}`
              : null}
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
          // No items-center: the row stretches, so the three share one height
          // even if a label ever finds a way to sit taller than its siblings.
          <div className="flex gap-2">
            <Link
              href={`/round/${round.code}/card`}
              className={cn(clusterControl, "border-border text-fairway")}
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
                className={cn(
                  clusterControl,
                  "border-border disabled:opacity-40",
                )}
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
            {/* border-primary, not the base's transparent: Button clips its
                background to the padding box, so a transparent 1.5px border
                would ring the fill in cream and read a size down from the
                two outlined controls beside it. */}
            <Button
              size="compact"
              className={cn(clusterControl, "border-primary")}
              disabled={pending}
              onClick={holeOut}
              data-testid="hole-out"
            >
              <PendingLabel
                pending={pending}
                busy={busy}
                putt={false}
                label="Hole out"
                // Short enough to sit in a third of the row: the long copy
                // set the button's width even while invisible.
                pendingLabel={
                  round.current_hole >= holes.length ? "Filing card…" : "Filing…"
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
            className={cn(
              clusterControl,
              "border-dashed border-muted-foreground/60 text-muted-foreground disabled:opacity-40",
            )}
          >
            <Minus size={14} aria-hidden /> Undo
          </button>
          {/* The pips are the private count — filled still in the pocket,
              hollow spent. They hang off the bottom edge rather than
              stacking above it, because a second line pushed the label off
              the centre its two neighbours sit on. */}
          {ruleset.mulligans > 0 ? (
            <button
              type="button"
              data-testid="mulligan"
              disabled={mulligansLeft === 0}
              onClick={() => setMulliganOpen(true)}
              aria-label={`Take a mulligan — ${mulligansLeft} of ${ruleset.mulligans} left`}
              className={cn(
                clusterControl,
                "relative border-marker/60 text-marker disabled:opacity-30",
              )}
            >
              <RotateCcw size={14} aria-hidden />
              Mulligan
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-1"
              >
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
          {/* The count rides the bottom edge where the mulligan pips sit, not
              the label: " · 2" inline made this the widest control in the
              row, and a track that widens on a called penalty is a row that
              moves under the thumb. */}
          <button
            type="button"
            aria-label={
              myHolePenalties.length > 0
                ? `Penalties — ${myHolePenalties.length} on this hole`
                : "Penalties"
            }
            onClick={() => setPenaltySheetOpen(true)}
            className={cn(
              clusterControl,
              "relative",
              myHolePenalties.length > 0
                ? "border-hazard bg-hazard/10 text-hazard"
                : "border-hazard/60 text-hazard",
            )}
          >
            <Flag size={14} aria-hidden />
            Penalties
            {myHolePenalties.length > 0 ? (
              <span
                aria-hidden
                className="tabular absolute inset-x-0 bottom-1 text-center font-mono text-[9px] leading-none font-bold"
              >
                ×{myHolePenalties.length}
              </span>
            ) : null}
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
