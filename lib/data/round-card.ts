import { createClient } from "@/lib/supabase/server";

/** What a link preview is allowed to know about a round. */
export interface RoundCard {
  name: string;
  status: string;
  holeCount: number;
  par: number;
  createdAt: string;
}

/**
 * Read a round the way a crawler sees it.
 *
 * Goes through `get_round_card`, a SECURITY DEFINER function, because an
 * Open Graph request carries no session at all — the ordinary RLS path would
 * return nothing. Never throws: a card route has to answer with an image even
 * for a code that does not exist, or the preview breaks rather than 404s.
 */
export async function getRoundCard(code: string): Promise<RoundCard | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_round_card", {
      join_code: code.toUpperCase(),
    });
    const row = data?.[0];
    if (!row) return null;

    return {
      name: row.name,
      status: row.status,
      holeCount: Number(row.hole_count),
      par: Number(row.par),
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}
