"use client";

import { ArrowUpRight } from "lucide-react";
import { Screen } from "@/components/shell/screen";
import { HoleStrip } from "@/components/round/hole-strip";
import { useLiveRound } from "@/components/round/use-live-round";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DotLeaderRow } from "@/components/ui/dot-leader";
import { Putt } from "@/components/ui/putt";
import { RuleDouble } from "@/components/ui/rule";
import { useAction } from "@/hooks/use-action";
import { useCountdown } from "@/hooks/use-countdown";
import { usePresence } from "@/hooks/use-presence";
import { teeUpHole } from "@/lib/actions/rounds";
import type { HoleWithVenue, RoundBundle } from "@/lib/data/rounds";
import { formatClock, remainingSeconds } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Turn-by-turn without a map of our own: the Maps app the player already
 * has, aimed by place_id when we know it, by name when we don't. */
function directionsUrl(hole: HoleWithVenue) {
  const destination = hole.venue?.address
    ? `${hole.venue_name}, ${hole.venue.address}`
    : hole.venue_name;
  const placeId = hole.venue?.google_place_id
    ? `&destination_place_id=${encodeURIComponent(hole.venue.google_place_id)}`
    : "";
  return `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${encodeURIComponent(destination)}${placeId}`;
}

function WalkCountdown({ deadline }: { deadline: Date }) {
  const remainingMs = useCountdown(deadline);
  const totalSeconds = remainingSeconds(remainingMs);
  if (totalSeconds === null)
    return <span className="tabular font-mono text-5xl font-bold">--:--</span>;
  if (totalSeconds <= 0)
    return <span className="font-serif text-3xl italic">any second now</span>;
  return (
    <span className="tabular font-mono text-5xl font-bold text-good">
      {formatClock(remainingMs)}
    </span>
  );
}

/** The phase between holes: where next, how far, what's the drink. */
export function WalkingView({ bundle }: { bundle: RoundBundle }) {
  const { round, holes, players, me } = bundle;
  useLiveRound(round.id);
  const { present, synced } = usePresence(round.id, me?.id ?? null);
  const { run, pending, busy } = useAction();

  const nextHole =
    holes.find((h) => h.number === round.current_hole) ?? holes[0];
  const filedHole = holes.find((h) => h.number === round.current_hole - 1);
  const isOfficial = me != null && ["host", "caddy"].includes(me.role);
  const walkDeadline = round.walk_deadline_at
    ? new Date(round.walk_deadline_at)
    : null;

  function teeUp() {
    run(() => teeUpHole(round.code));
  }

  return (
    <Screen data-testid="walking-view">
      <RuleDouble busy={busy} />
      <HoleStrip
        holeNumbers={holes.map((h) => h.number)}
        currentHole={round.current_hole}
      />

      <div className="eyebrow text-fairway">
        Hole {round.current_hole - 1} filed · walking
      </div>

      <div>
        <div className="text-sm font-extrabold text-muted-foreground">
          NEXT TEE {walkDeadline ? "IN" : ""}
        </div>
        {walkDeadline ? (
          <WalkCountdown deadline={walkDeadline} />
        ) : (
          <span className="font-serif text-3xl italic">
            when you get there
          </span>
        )}
      </div>

      {/* The leg: filed pub → next tee */}
      <div className="flex items-center" aria-hidden>
        <span className="size-3 rounded-full bg-fairway" />
        <span className="flex-1 border-t-2 border-dashed border-border" />
        <span className="size-3.5 rounded-full border-2 border-marker" />
      </div>
      <div className="eyebrow flex justify-between">
        <span>{filedHole?.venue_name ?? "The first tee"}</span>
        <span>{nextHole.venue_name}</span>
      </div>

      <Card className="gap-1 px-4 py-4">
        <div className="eyebrow">
          Hole {nextHole.number} · Par {nextHole.par}
        </div>
        <div
          className="font-serif text-xl italic"
          data-testid="walking-next-venue"
        >
          {nextHole.venue_name}
        </div>
        <DotLeaderRow
          label={nextHole.drink}
          value={nextHole.hazard ? `${nextHole.hazard} hazard` : "no hazard"}
        />
      </Card>

      <a
        href={directionsUrl(nextHole)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border text-sm font-bold text-fairway"
      >
        <ArrowUpRight size={15} aria-hidden />
        Directions in Google Maps
      </a>

      {synced ? (
        <p className="tabular text-center font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
          {present.size} OF {players.length} WALKING
        </p>
      ) : null}

      <div className="mt-auto flex flex-col gap-2">
        {isOfficial ? (
          <Button
            onClick={teeUp}
            disabled={pending}
            data-testid="tee-up"
            className={cn("min-h-14 flex-col gap-0")}
          >
            {pending ? (
              <>
                <span className="inline-flex items-baseline gap-2">
                  Calling everyone to the tee
                  <Putt className={cn(!busy && "invisible")} />
                </span>
                <span className="text-[9px] font-extrabold tracking-[0.16em] opacity-70">
                  ARMING ON EVERY PHONE
                </span>
              </>
            ) : (
              <>
                <span>Tee up hole {nextHole.number}</span>
                <span className="text-[9px] font-extrabold tracking-[0.16em] opacity-70">
                  ARMS EVERY TIMER
                </span>
              </>
            )}
          </Button>
        ) : (
          <p className="pb-2 text-center text-[11px] text-muted-foreground">
            The caddy tees up when the group arrives — enjoy the walk.
          </p>
        )}
      </div>
    </Screen>
  );
}
