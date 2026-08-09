"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PendingLabel } from "@/components/ui/pending-label";
import { useAction } from "@/hooks/use-action";
import { approveSeatRescue, dismissSeatRescue } from "@/lib/actions/rounds";
import { clockTime12 } from "@/lib/time";
import type { Tables } from "@/types/supabase-helpers";

/**
 * The knock at the door, as the officials see it: a seatless phone asked to
 * pick a card back up (request_seat_rescue), and nothing moves until someone
 * here waves them in. Rendered on every officials' surface — lobby, play,
 * the walk, the marker's card, results — because the knock arrives wherever
 * the caddy happens to be looking. Players see nothing; the row change
 * reaches this component through the round_players realtime subscription
 * the views already hold.
 */
export function RescueKnock({
  code,
  players,
  me,
}: {
  code: string;
  players: Tables<"round_players">[];
  me: Tables<"round_players"> | null;
}) {
  const { run, pending, busy } = useAction();

  const isOfficial = me != null && ["host", "caddy"].includes(me.role);
  const knocks = players.filter(
    (player) => player.rescue_requested_by !== null,
  );
  if (!isOfficial || knocks.length === 0) return null;

  function waveIn(player: Tables<"round_players">) {
    run(async () => {
      const result = await approveSeatRescue(code, player.id);
      if (!result.error)
        toast(`${player.display_name}'s card is back — picked up on a new phone.`);
      return result;
    });
  }

  function turnAway(player: Tables<"round_players">) {
    run(() => dismissSeatRescue(code, player.id));
  }

  return (
    <div className="flex flex-col gap-2" data-testid="rescue-knocks">
      {knocks.map((player) => {
        const asked = player.rescue_requested_at
          ? new Date(player.rescue_requested_at)
          : null;
        return (
          <div
            key={player.id}
            data-testid="rescue-knock"
            className="rounded-xl border border-marker bg-marker/10 px-4 py-3"
          >
            <div className="eyebrow text-marker">At the door</div>
            <p className="mt-1 text-sm">
              <b>{player.display_name}</b> asks to pick their card back up on a
              new phone.
              {asked !== null && !isNaN(asked.getTime()) ? (
                <span className="block text-[11px] text-muted-foreground">
                  Asked at{" "}
                  {clockTime12(asked.getHours() * 60 + asked.getMinutes())} —
                  check it&apos;s really them before you wave.
                </span>
              ) : null}
            </p>
            <div className="mt-2.5 grid grid-cols-[1fr_1.4fr] gap-2">
              <Button
                variant="secondary"
                disabled={pending}
                data-testid="rescue-turn-away"
                onClick={() => turnAway(player)}
              >
                Not them
              </Button>
              <Button
                disabled={pending}
                data-testid="rescue-wave-in"
                onClick={() => waveIn(player)}
              >
                <PendingLabel
                  pending={pending}
                  busy={busy}
                  label="Wave them in"
                  pendingLabel="Handing the card over"
                />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
