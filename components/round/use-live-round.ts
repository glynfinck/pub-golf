"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { actionNavigating, refreshQuietUntil } from "@/lib/action-window";
import { createClient } from "@/lib/supabase/client";

// `holes` is on the list because a hole's pub can change mid-round (the
// shutters come down and the caddy swaps it). Everything else about a hole
// is fixed at round creation, so this row is quiet until that happens.
const LIVE_TABLES = [
  "rounds",
  "round_players",
  "scores",
  "penalties",
  "holes",
];

/**
 * The safety-net poll's cadence. Fast enough that a phone which missed an
 * event still catches up inside the e2e suite's 15-second expectations
 * (one interval, the coalesce beat, one fetch); slow enough that a table
 * of twenty phones is quieter than its own score taps.
 */
const POLL_MS = 10_000;

/**
 * Server components are the source of truth; realtime just tells us when
 * to re-fetch. Any change to this round's rows triggers router.refresh(),
 * so every phone re-renders from the same Postgres state.
 *
 * One transition does not go through that door. Moving a player from the
 * play screen to the results is a *server* redirect — the play route reads
 * `status = finished` and redirects — which only happens if router.refresh()
 * carries the redirect back through an RSC refetch. When it doesn't, there
 * is nothing else: the phone stays on a hole nobody is playing, and every
 * later poll repeats the same failed refetch rather than trying anything
 * new. That is a card filed with a player still stood at the bar, and it is
 * what `onRoundFinished` is for — the realtime payload already carries the
 * new status, so the screen that cares can navigate on it directly and stop
 * depending on the redirect surviving the round trip.
 */
export function useLiveRound(
  roundId: string,
  options?: {
    /** Fired when a rounds event says the card has just been filed. Only
     * the screens a finished round must leave should pass this. */
    onRoundFinished?: () => void;
  },
) {
  const router = useRouter();
  // Held in a ref so a caller's inline closure never re-subscribes the
  // channel — resubscribing mid-round drops events for the handshake. Kept
  // in an effect rather than assigned in render, which the purity rules
  // forbid.
  const onFinished = useRef(options?.onRoundFinished);
  useEffect(() => {
    onFinished.current = options?.onRoundFinished;
  });

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | undefined;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      // Coalesce bursts (a score upsert + penalty insert) into one refresh,
      // and defer — never drop — events landing inside an action's quiet
      // window: our own write's echo is already in the action's revalidate
      // payload, so answering it immediately buys the same bytes twice.
      clearTimeout(timeout);
      const fire = () => {
        const wait = refreshQuietUntil() - Date.now();
        if (wait > 0) {
          timeout = setTimeout(fire, wait);
          return;
        }
        router.refresh();
      };
      timeout = setTimeout(fire, 150);
    };

    (async () => {
      // Realtime enforces RLS per subscriber: the socket must carry the
      // user's JWT, not the anon key, or every event is silently filtered.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) await supabase.realtime.setAuth(session.access_token);

      channel = supabase.channel(`round:${roundId}`);
      for (const table of LIVE_TABLES) {
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter:
              table === "rounds"
                ? `id=eq.${roundId}`
                : `round_id=eq.${roundId}`,
          },
          (payload) => {
            // The card has just been filed. Tell the screen before the
            // refresh, and hold refreshes across the route change it makes
            // — a refresh landing inside a navigation cancels it, which is
            // the same trap the reopen button fell into.
            if (
              table === "rounds" &&
              (payload.new as { status?: string } | null)?.status === "finished"
            ) {
              const leave = onFinished.current;
              if (leave) {
                actionNavigating(Date.now());
                leave();
                return;
              }
            }
            refresh();
          },
        );
      }
      // Catch up the moment the socket is live, and again after every
      // reconnect. Between the server render and SUBSCRIBED there is a
      // window — a handshake, and a long one on a cold stack or a pub's
      // wifi — in which nothing is listening, so a player who joins inside
      // it was simply never seen: no event arrives, nothing re-fetches,
      // and the lobby stays a player short until some later change
      // happens to fire. Supabase re-fires SUBSCRIBED on reconnect too,
      // which is the same hole after a phone comes out of a pocket.
      // refresh() already coalesces and respects the action quiet window,
      // so the catch-up costs at most one extra fetch per connect.
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    })();

    // The socket is a hint, not a contract. Realtime checks RLS per
    // subscriber per change, and under load a change can be dropped with
    // the channel still reading SUBSCRIBED — no error, no reconnect, so
    // the catch-up above never fires, and one phone stands a move behind
    // until the next event happens to land. CI caught exactly that (a
    // fourth phone missed the round-finished event and held the play
    // screen while the other three read the results), and a pub's wifi
    // will find it too. The slow poll is the net under the wire act:
    // refresh() coalesces and defers through the action quiet window, so
    // a tick landing while realtime is healthy costs one refetch of a
    // screen that was current anyway.
    const poll = setInterval(refresh, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      if (channel) supabase.removeChannel(channel);
    };
  }, [roundId, router]);
}
