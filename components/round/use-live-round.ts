"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { refreshQuietUntil } from "@/lib/action-window";
import { createClient } from "@/lib/supabase/client";

const LIVE_TABLES = ["rounds", "round_players", "scores", "penalties"];

/**
 * Server components are the source of truth; realtime just tells us when
 * to re-fetch. Any change to this round's rows triggers router.refresh(),
 * so every phone re-renders from the same Postgres state.
 */
export function useLiveRound(roundId: string) {
  const router = useRouter();

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
          refresh,
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

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      if (channel) supabase.removeChannel(channel);
    };
  }, [roundId, router]);
}
