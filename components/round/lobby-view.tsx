"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { useLiveRound } from "@/components/round/use-live-round";
import { Button } from "@/components/ui/button";
import { DotLeaderRow } from "@/components/ui/dot-leader";
import { PendingLabel } from "@/components/ui/pending-label";
import { RuleDouble } from "@/components/ui/rule";
import { usePresence } from "@/hooks/use-presence";
import { Stepper } from "@/components/ui/stepper";
import { useAction } from "@/hooks/use-action";
import { useDraftFigures } from "@/hooks/use-draft-figures";
import {
  setPlayerHandicap,
  setPlayerRole,
  startRound,
} from "@/lib/actions/rounds";
import type { RoundBundle } from "@/lib/data/rounds";
import { MAX_HANDICAP } from "@/lib/rules";
import { readHolePenalties, readRuleset } from "@/lib/ruleset";
import { cn } from "@/lib/utils";

export function LobbyView({ bundle }: { bundle: RoundBundle }) {
  const { round, holes, players, me } = bundle;
  useLiveRound(round.id);
  const router = useRouter();
  const { present, synced } = usePresence(round.id, me?.id ?? null);
  const { run, pending, busy } = useAction();
  const [copied, setCopied] = useState(false);

  // Tee off ends with a navigation to /play that refetches everything —
  // warm that route while the lobby idles so the arrival is out of cache.
  useEffect(() => {
    router.prefetch(`/round/${round.code}/play`);
  }, [router, round.code]);

  const isOfficial = me != null && ["host", "caddy"].includes(me.role);
  const isHost = me?.role === "host";
  const par = holes.reduce((sum, hole) => sum + hole.par, 0);
  const ruleset = readRuleset(round.ruleset);
  const hazardHoles = holes
    .filter((hole) => hole.hazard)
    .map((hole) => hole.number);
  const localRuleHoles = holes
    .filter((hole) => readHolePenalties(hole.penalties).length > 0)
    .map((hole) => hole.number);

  // Optimistic handicaps: the figure moves on the host's tap, and a
  // "tap-tap" to two becomes one write.
  const handicaps = useDraftFigures({
    server: Object.fromEntries(
      players.map((player) => [player.id, player.handicap]),
    ),
    write: (playerId, value) =>
      setPlayerHandicap(round.code, playerId, value),
  });

  function share() {
    const url = `${window.location.origin}/round/${round.code}`;
    if (navigator.share) {
      navigator
        .share({ title: round.name, text: `Entry code ${round.code}`, url })
        .catch(() => undefined);
    } else {
      navigator.clipboard.writeText(
        `${round.name} — entry code ${round.code} — ${url}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function teeOff() {
    run(() => startRound(round.code));
  }

  function toggleCaddy(playerId: string, currentRole: string) {
    if (!isHost) return;
    run(() =>
      setPlayerRole(
        round.code,
        playerId,
        currentRole === "caddy" ? "player" : "caddy",
      ),
    );
  }

  return (
    <Screen>
      <RuleDouble busy={busy} />
      <ScreenHeader eyebrow={`Lobby · ${round.name}`} title="The first tee" />

      {/* The letterpress plate: entry code, optically centered against its
          own letterspacing. */}
      <button
        type="button"
        onClick={share}
        className="w-full rounded-xl border-[1.5px] border-foreground/50 bg-card px-4 py-3.5 text-center outline outline-offset-[3px] outline-foreground/50"
      >
        <span className="eyebrow block" style={{ textIndent: "0.2em" }}>
          {copied ? "Copied!" : "Entry code · tap to share"}
        </span>
        <span
          className="tabular mt-1 block font-serif text-3xl tracking-[0.28em]"
          style={{ textIndent: "0.28em" }}
        >
          {round.code}
        </span>
      </button>

      {/* The guest list, set like a dinner menu. */}
      <div data-testid="lobby-players">
        {players.map((player) => (
          <div
            key={player.id}
            className="flex min-h-13 items-baseline gap-2 border-b border-dotted border-border"
          >
            <span className="min-w-0 self-center">
              <span className="block truncate text-sm font-bold">
                {player.display_name}
                {player.id === me?.id ? (
                  <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                    you
                  </span>
                ) : null}
              </span>
              {player.role === "caddy" ? (
                <span className="block text-[10px] text-muted-foreground">
                  Caddy · stays sober, final word
                </span>
              ) : null}
              {ruleset.handicaps ? (
                isOfficial ? (
                  <span className="mt-1 flex items-center gap-1.5">
                    <span
                      className={cn(
                        "eyebrow",
                        handicaps.settling(player.id) && "text-marker",
                      )}
                    >
                      Hcp
                    </span>
                    <Stepper
                      className="min-h-9 w-24 px-1"
                      value={handicaps.valueOf(player.id)}
                      onChange={(next) => handicaps.set(player.id, next)}
                      max={MAX_HANDICAP}
                      decrementLabel={`Lower ${player.display_name}'s handicap`}
                      incrementLabel={`Raise ${player.display_name}'s handicap`}
                      label="handicap"
                    />
                  </span>
                ) : player.handicap > 0 ? (
                  <span className="block text-[10px] text-muted-foreground">
                    Playing off {player.handicap}
                  </span>
                ) : null
              ) : null}
            </span>
            <span aria-hidden className="leader flex-1 self-center" />
            <span className="shrink-0 self-center">
              {isHost && player.role !== "host" ? (
                <Button
                  size="compact"
                  variant="outline"
                  disabled={pending}
                  onClick={() => toggleCaddy(player.id, player.role)}
                >
                  {player.role === "caddy" ? "Unmake caddy" : "Make caddy"}
                </Button>
              ) : synced && !present.has(player.id) ? (
                <span className="text-[10px] font-bold tracking-[0.14em] text-muted-foreground">
                  WALKING IN…
                </span>
              ) : (
                <span
                  className={cn(
                    "text-[10px] font-bold tracking-[0.14em]",
                    player.role === "host" ? "text-marker" : "text-good",
                  )}
                >
                  {player.role === "host"
                    ? "HOST"
                    : player.role === "caddy"
                      ? "CADDY"
                      : "READY"}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <DotLeaderRow
          label={`${holes.length} holes`}
          value={`par ${par}`}
          className="text-xs"
        />
        {ruleset.hazards && hazardHoles.length > 0 ? (
          <DotLeaderRow
            label="Hazards in force"
            value={hazardHoles.join(" · ")}
            className="text-xs"
          />
        ) : null}
        {ruleset.holeTimerMinutes ? (
          <DotLeaderRow
            label="Timed holes"
            value={`${ruleset.holeTimerMinutes} min`}
            className="text-xs"
          />
        ) : null}
        {ruleset.softSubstituteScoresPar ? (
          <DotLeaderRow
            label="Soft substitutes"
            value="score par"
            className="text-xs"
          />
        ) : null}
        {localRuleHoles.length > 0 ? (
          <DotLeaderRow
            label="Local rules"
            value={localRuleHoles.join(" · ")}
            className="text-xs"
          />
        ) : null}
        {ruleset.breakfastBalls > 0 ? (
          <DotLeaderRow
            label="Breakfast balls"
            value={`${ruleset.breakfastBalls} each · +${ruleset.breakfastBallStrokes}`}
            className="text-xs"
          />
        ) : null}
        {ruleset.handicaps ? (
          <DotLeaderRow
            label="Handicaps"
            value="net scoring"
            className="text-xs"
          />
        ) : null}
      </div>

      {isOfficial ? (
        <Button
          onClick={teeOff}
          disabled={pending}
          data-testid="tee-off"
          className="mt-auto"
        >
          <PendingLabel
            pending={pending}
            busy={busy}
            label="Tee off — all cards go live"
            pendingLabel="Counting everyone in"
          />
        </Button>
      ) : (
        <p className="mt-auto text-center text-sm text-muted-foreground">
          Waiting for the host to tee off…
        </p>
      )}

      <p className="pb-2 text-center font-serif text-xs italic text-muted-foreground">
        A card is a bit of fun, not a contract.
      </p>
    </Screen>
  );
}
