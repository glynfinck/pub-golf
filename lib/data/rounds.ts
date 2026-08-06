import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/supabase-helpers";

/** A hole with its cached Google Places venue (null for manual holes). */
export type HoleWithVenue = Tables<"holes"> & {
  venue: Pick<
    Tables<"venues">,
    "google_place_id" | "address" | "lat" | "lng"
  > | null;
};

export interface RoundBundle {
  round: Tables<"rounds">;
  holes: HoleWithVenue[];
  players: Tables<"round_players">[];
  scores: Tables<"scores">[];
  penalties: Tables<"penalties">[];
  /** The signed-in viewer's player row, if they are in the round. */
  me: Tables<"round_players"> | null;
}

/** Cached per request — every round route asks for the user at least twice. */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Everything a round screen needs, fetched as the caller (RLS applies). */
export async function getRoundByCode(
  code: string,
): Promise<RoundBundle | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: round } = await supabase
    .from("rounds")
    .select("*")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (!round) return null;

  const [{ data: holes }, { data: players }, { data: scores }, { data: penalties }] =
    await Promise.all([
      supabase
        .from("holes")
        .select("*, venue:venues(google_place_id, address, lat, lng)")
        .eq("round_id", round.id)
        .order("number"),
      supabase
        .from("round_players")
        .select("*")
        .eq("round_id", round.id)
        .order("joined_at"),
      supabase.from("scores").select("*").eq("round_id", round.id),
      supabase.from("penalties").select("*").eq("round_id", round.id),
    ]);

  return {
    round,
    holes: holes ?? [],
    players: players ?? [],
    scores: scores ?? [],
    penalties: penalties ?? [],
    me: (players ?? []).find((player) => player.profile_id === user.id) ?? null,
  };
}

export interface MyRound {
  code: string;
  name: string;
  status: string;
  current_hole: number;
  created_at: string;
  hole_count: number;
  role: string;
}

/** The viewer's rounds, newest first, for the clubhouse and history tabs. */
export async function getMyRounds(): Promise<MyRound[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("round_players")
    .select("role, rounds!inner(code, name, status, current_hole, created_at, holes(count))")
    .eq("profile_id", user.id);

  return (data ?? [])
    .map((row) => {
      const round = row.rounds as unknown as {
        code: string;
        name: string;
        status: string;
        current_hole: number;
        created_at: string;
        holes: { count: number }[];
      };
      return {
        code: round.code,
        name: round.name,
        status: round.status,
        current_hole: round.current_hole,
        created_at: round.created_at,
        hole_count: round.holes[0]?.count ?? 0,
        role: row.role,
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return data ? { ...data, isAnonymous: user.is_anonymous ?? false } : null;
}
