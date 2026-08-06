"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Who's actually here: Supabase Realtime Presence keyed by round_players
 * id. `synced` is false until the first sync event — render no absence
 * tags before then, or everyone flashes "walking in" on first paint.
 * Failure-safe: if the socket never connects, present stays empty and
 * synced stays false, and callers fall back to their static UI.
 */
export function usePresence(roundId: string, myPlayerId: string | null) {
  const [present, setPresent] = useState<ReadonlySet<string>>(new Set());
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!myPlayerId) return;
    const supabase = createClient();
    let cancelled = false;

    const channel = supabase.channel(`presence:round:${roundId}`, {
      config: { presence: { key: myPlayerId } },
    });
    channel.on("presence", { event: "sync" }, () => {
      if (cancelled) return;
      setPresent(new Set(Object.keys(channel.presenceState())));
      setSynced(true);
    });

    const connect = async () => {
      // The realtime socket must carry the user JWT or RLS-backed channels
      // silently drop everything — same gotcha as postgres_changes.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) await supabase.realtime.setAuth(session.access_token);
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED" && !cancelled) await channel.track({});
      });
    };
    void connect();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roundId, myPlayerId]);

  return { present, synced };
}
