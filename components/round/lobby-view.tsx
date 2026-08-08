"use client";

import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Screen, ScreenHeader } from "@/components/shell/screen";
import { LobbyPlayerSheet } from "@/components/round/lobby-player-sheet";
import { RoundBar } from "@/components/round/round-bar";
import { useLiveRound } from "@/components/round/use-live-round";
import { Button } from "@/components/ui/button";
import { DotLeaderRow } from "@/components/ui/dot-leader";
import { PendingLabel } from "@/components/ui/pending-label";
import { usePresence } from "@/hooks/use-presence";
import { useAction } from "@/hooks/use-action";
import { useDraftFigures } from "@/hooks/use-draft-figures";
import {
  setPlayerHandicap,
  setPlayerRole,
  startRound,
} from "@/lib/actions/rounds";
import type { RoundBundle } from "@/lib/data/rounds";
import { roundRuleLines } from "@/lib/round-rules";
import { readRuleset } from "@/lib/ruleset";
import { clockTime12, roundMinutes } from "@/lib/time";
import { cn } from "@/lib/utils";

export function LobbyView({ bundle }: { bundle: RoundBundle }) {
  const { round, holes, players, me } = bundle;
  useLiveRound(round.id);
  const router = useRouter();
  const { present, synced } = usePresence(round.id, me?.id ?? null);
  const { run, pending, busy } = useAction();
  const [copied, setCopied] = useState(false);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);

  // Tee off ends with a navigation to /play that refetches everything —
  // warm that route while the lobby idles so the arrival is out of cache.
  useEffect(() => {
    router.prefetch(`/round/${round.code}/play`);
  }, [router, round.code]);

  const isOfficial = me != null && ["host", "caddy"].includes(me.role);
  const isHost = me?.role === "host";
  const ruleset = readRuleset(round.ruleset);

  // The 19th-hole estimate: pubs at the planned pace plus the walks the
  // course already carries. Advisory, like the tee time it hangs off.
  const walkTotal = holes.reduce(
    (sum, hole) => sum + (hole.walk_minutes_to_next ?? 0),
    0,
  );
  const totalMinutes = roundMinutes(
    holes.length,
    ruleset.minutesPerPub,
    walkTotal,
  );
  const scheduledTee = ruleset.scheduledTeeOff
    ? new Date(ruleset.scheduledTeeOff)
    : null;
  const teeValid = scheduledTee !== null && !isNaN(scheduledTee.getTime());
  const teeMinutesOfDay = teeValid
    ? scheduledTee.getHours() * 60 + scheduledTee.getMinutes()
    : null;

  // The lobby prints the diary, not the abstraction: with a first tee on
  // the card, the pace line becomes the tee time and the expected finish.
  // Everything else comes straight from roundRuleLines, the same door the
  // mid-round rules sheet reads.
  const ruleLines = roundRuleLines(ruleset, holes).flatMap((line) =>
    line.id === "pace" && teeValid && teeMinutesOfDay !== null
      ? [
          {
            id: "first-tee",
            label: "First tee",
            value: `${scheduledTee.toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })} · ${clockTime12(teeMinutesOfDay)}`,
          },
          {
            id: "finish",
            label: "Expected 19th hole",
            value: `~${clockTime12(teeMinutesOfDay + totalMinutes)}`,
          },
        ]
      : [line],
  );

  // Optimistic handicaps: the figure moves on the host's tap, and a
  // "tap-tap" to two becomes one write. Shared between the sheet's stepper
  // and the rows' printed figures, so both move together.
  const handicaps = useDraftFigures({
    server: Object.fromEntries(
      players.map((player) => [player.id, player.handicap]),
    ),
    write: (playerId, value) =>
      setPlayerHandicap(round.code, playerId, value),
  });

  // A row opens the adjust sheet when the viewer can change something on
  // it: the host toggles caddies on anyone else, and either official sets
  // handicaps when the round plays them.
  function canAdjust(player: RoundBundle["players"][number]) {
    return (
      (isHost && player.role !== "host") || (isOfficial && ruleset.handicaps)
    );
  }
  const adjustable = players.filter(canAdjust);
  const adjusting = players.find((player) => player.id === adjustingId) ?? null;

  function stepAdjusting(delta: 1 | -1) {
    if (!adjusting || adjustable.length === 0) return;
    const index = adjustable.findIndex((player) => player.id === adjusting.id);
    const next =
      adjustable[
        (Math.max(index, 0) + delta + adjustable.length) % adjustable.length
      ];
    setAdjustingId(next.id);
  }

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

  function toggleCaddy() {
    if (!isHost || !adjusting || adjusting.role === "host") return;
    run(() =>
      setPlayerRole(
        round.code,
        adjusting.id,
        adjusting.role === "caddy" ? "player" : "caddy",
      ),
    );
  }

  return (
    <Screen>
      <RoundBar round={round} holes={holes} busy={busy} />
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

      {/* The guest list, set like a dinner menu — and the row never grows.
          One line per guest, always: name, leader, figure, standing. The
          standing never yields its seat to a control (the host is the one
          person who must see WALKING IN…); every playing row prints its
          figure — OFF 2, or SCRATCH at zero; the caddy carries no card, so
          no figure — and everything operable lives in the adjust sheet
          behind the row, so nothing can drag this line out of rhythm. */}
      <div data-testid="lobby-players">
        {players.map((player) => {
          const figureValue = handicaps.valueOf(player.id);
          const figure =
            ruleset.handicaps && player.role !== "caddy"
              ? figureValue > 0
                ? `OFF ${figureValue}`
                : "SCRATCH"
              : null;
          const line = (
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 truncate text-sm font-bold transition-colors group-hover:text-marker group-focus-visible:text-marker">
                {player.display_name}
                {player.id === me?.id ? (
                  <span className="ml-1.5 inline-block rounded border border-border px-1 py-px align-[2px] text-[8px] font-bold tracking-[0.13em] uppercase text-muted-foreground">
                    You
                  </span>
                ) : null}
              </span>
              <span aria-hidden className="leader flex-1 self-baseline" />
              {figure !== null ? (
                <span
                  className={cn(
                    "shrink-0 text-[10px] font-bold tracking-[0.14em]",
                    handicaps.settling(player.id)
                      ? "text-marker"
                      : "text-muted-foreground",
                  )}
                >
                  {figure}
                </span>
              ) : null}
              {synced && !present.has(player.id) ? (
                <span className="shrink-0 text-[10px] font-bold tracking-[0.14em] text-muted-foreground">
                  WALKING IN…
                </span>
              ) : (
                <span
                  className={cn(
                    "shrink-0 text-[10px] font-bold tracking-[0.14em]",
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
              {canAdjust(player) ? (
                <ChevronRight
                  aria-hidden
                  size={14}
                  className="shrink-0 self-center text-muted-foreground/70"
                />
              ) : null}
            </div>
          );
          return canAdjust(player) ? (
            <button
              key={player.id}
              type="button"
              data-testid="lobby-player-row"
              onClick={() => setAdjustingId(player.id)}
              className="group flex min-h-13 w-full flex-col justify-center border-b border-dotted border-border py-2 text-left focus-visible:outline-none"
            >
              {line}
            </button>
          ) : (
            <div
              key={player.id}
              data-testid="lobby-player-row"
              className="flex min-h-13 flex-col justify-center border-b border-dotted border-border py-2"
            >
              {line}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        {ruleLines.map((line) => (
          <DotLeaderRow
            key={line.id}
            label={line.label}
            value={line.value}
            className="text-xs"
          />
        ))}
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

      <LobbyPlayerSheet
        open={adjusting !== null}
        player={adjusting}
        onOpenChange={(open) => {
          if (!open) setAdjustingId(null);
        }}
        canStep={adjustable.length > 1}
        onStep={stepAdjusting}
        showRoleToggle={isHost && adjusting?.role !== "host"}
        onToggleCaddy={toggleCaddy}
        pending={pending}
        handicapsOn={ruleset.handicaps}
        handicaps={handicaps}
      />
    </Screen>
  );
}
