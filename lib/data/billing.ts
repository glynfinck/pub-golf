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
 * Whether the viewer has ever bought a green fee — the till's own condition
 * (`topupRefusal`), read for the screens that decide whether the top-ups
 * appear at all.
 *
 * The rule the till enforces and the shelf obeys is the same rule the eye
 * should meet: a top-up that cannot be sold to this viewer is not shown to
 * this viewer. Deliberately not `getDayPass`: that asks whether a pass is
 * *running*, and this asks whether one was ever bought — any fee counts
 * however long its day has been over, because the goes a top-up sells are
 * durable. A refunded fee's row is deleted with its grants, so it stops
 * answering here by the same cascade. Signed-out and anonymous viewers are
 * simply not members, and read false.
 */
export const everBoughtGreenFee = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return false;

  const { data } = await supabase
    .from("entitlements")
    .select("id")
    .eq("user_id", user.id)
    .eq("kind", "green_fee")
    .limit(1)
    .maybeSingle();
  return data !== null;
});

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
