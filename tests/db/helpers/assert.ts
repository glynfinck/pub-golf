import type { PostgrestError } from "@supabase/supabase-js";
import { expect } from "vitest";

import { adminClient } from "@/tests/support/clients";

/**
 * The single most common false green in an RLS suite:
 *
 *   const { error } = await attacker.from("rounds").update({ code: "HIJACK" })…
 *   expect(error).toBeNull()          // passes whether or not it worked
 *
 * An UPDATE or DELETE the policy filters out is not an error. It matches no
 * rows, returns 204, and reports success. The only honest question is what the
 * stored row says afterwards — so read it back with a key that ignores RLS,
 * never through the attacker's own client.
 */
export async function storedRound(id: string) {
  const { data, error } = await adminClient()
    .from("rounds")
    .select("code, host, status, current_hole, hole_phase")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function storedSeat(roundId: string, profileId: string) {
  const { data, error } = await adminClient()
    .from("round_players")
    .select("id, role, display_name, round_id, profile_id")
    .eq("round_id", roundId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function seatCount(roundId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from("round_players")
    .select("id", { count: "exact", head: true })
    .eq("round_id", roundId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * A write the database refused outright. Postgres reports a policy violation
 * as 42501 and a broken foreign key as 23503 — the two ways this schema says
 * no. Nothing else counts: a unique violation (23505) means the row already
 * existed and a not-null violation (23502) means the fixture handed over a
 * null id, and both would be a broken test dressed up as a blocked attack.
 */
export function expectDenied(error: PostgrestError | null): void {
  expect(error).not.toBeNull();
  expect(["42501", "23503"]).toContain(error?.code);
}

/** Rows of `rounds` matching an id, read past RLS. */
export async function roundExists(id: string): Promise<boolean> {
  const { count, error } = await adminClient()
    .from("rounds")
    .select("id", { count: "exact", head: true })
    .eq("id", id);
  if (error) throw error;
  return (count ?? 0) > 0;
}
