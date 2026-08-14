import { cache } from "react";

import { dayPassLive } from "@/lib/billing";
import { createClient } from "@/lib/supabase/server";

export interface DayPass {
  /** ISO, or null for a pass that never runs out. */
  expiresAt: string | null;
}

/**
 * The signed-in host's green fee, if one is still running.
 *
 * Reads the buyer's own row and nothing else — a day pass carries no round,
 * and the entitlements policy shows a round-less row to its owner alone.
 * That is exactly the audience for it: the pass appears on the Clubhouse and
 * on the new-round form, both of which are the buyer's own screens, and
 * never on a guest surface.
 *
 * Cached per request: the Clubhouse asks once for the card and once for the
 * league's door.
 */
/**
 * `everBoughtGreenFee` stood here for one commit: the till's own condition
 * (`topupRefusal`), read so `/tariff` could hide the top-up rungs from a
 * reader who could not buy them. The board went back to listing everything
 * and explaining each entry instead — a price list answers a confusing rung
 * by explaining it, not by hiding it — so nothing calls this any more, and
 * an uncalled read of somebody's purchases is not a thing to keep. The rule
 * it enforced lives where it always belonged: at the till.
 */

export const getDayPass = cache(async (): Promise<DayPass | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return null;

  const { data } = await supabase
    .from("entitlements")
    .select("expires_at")
    .eq("user_id", user.id)
    .eq("kind", "green_fee")
    .order("expires_at", { ascending: false, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  // Filtered here rather than in the query so "never runs out" needs no
  // `or(...)` string: the rule lives in one pure function both sides use.
  return dayPassLive(data.expires_at, Date.now())
    ? { expiresAt: data.expires_at }
    : null;
});
