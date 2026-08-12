import "server-only";

import { caddyReady, shutGates, showCaddyDiagnostics } from "@/lib/caddy/readiness";
import { CADDY_COURSES_PER_FEE, CADDY_GRANT_SIZE } from "@/lib/caddy/credits";
import { caddyAllowance } from "@/lib/data/caddy";
import { getDayPass } from "@/lib/data/billing";
import { getSessionUser } from "@/lib/data/rounds";
import { createClient } from "@/lib/supabase/server";
import type { CaddyAllowance } from "@/lib/data/caddy";

/**
 * Whether the caddy may appear on a drafting table, and what it needs to know.
 *
 * Pulled out of `/courses/new` when the saved-course screen needed the same
 * answer. Two screens asking the same question two ways is how they came to
 * disagree in the first place: `/courses/new` gated the caddy on four
 * conditions and `/courses/[id]` gated it on `!editing`, which is not a
 * condition about the caddy at all — it is a condition about which door you
 * came in by, and it silently meant a saved course could never be tweaked.
 */
export interface CaddyStand {
  ready: boolean;
  hasPass: boolean;
  /** When the fee's day runs out, so a screen can say rather than imply. */
  passExpiresAt: string | null;
  allowance: CaddyAllowance;
  /** Only ever off production, and only when the deploy is misconfigured —
   * the gate names the variable that is missing rather than making somebody
   * guess, which is what cost hours on preview. */
  gates: ReturnType<typeof shutGates> | null;
}

/**
 * Does this database have the caddy's tables yet?
 *
 * Asked rather than assumed because Vercel and Supabase deploy independently —
 * DEPLOYMENT.md's whole reason for insisting migrations be additive — so the
 * app can be live against a schema that has not caught up. A head count reads
 * no rows and costs nothing; RLS would scope it to this host anyway.
 */
async function caddyTablesPresent(): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("caddy_sessions")
    .select("id", { count: "exact", head: true });
  if (!error) return true;
  // Two codes for one condition, because they come from different layers and
  // which one you get depends on the PostgREST version in front of the
  // database: 42P01 is Postgres saying the relation does not exist, PGRST205
  // is PostgREST saying it is not in its schema cache. Checking only the
  // Postgres one would report a missing table as present on any modern stack —
  // which is precisely the deploy this check exists to catch.
  //
  // Anything else — a policy returning nothing, a grant refusal — means the
  // table is there, which is all this asks.
  return error.code !== "42P01" && error.code !== "PGRST205";
}

export async function caddyStand(): Promise<CaddyStand> {
  const [pass, user, tablesPresent] = await Promise.all([
    getDayPass(),
    getSessionUser(),
    caddyTablesPresent(),
  ]);

  const allowance = tablesPresent
    ? await caddyAllowance()
    : {
        canPlan: true,
        left: CADDY_COURSES_PER_FEE,
        courseId: null,
        tweaks: CADDY_GRANT_SIZE.tweak,
      };

  const gateInput = {
    signedIn: user != null,
    anonymous: user?.is_anonymous === true,
    hasPass: pass != null,
    tablesPresent,
  };
  const ready = caddyReady(process.env, gateInput);

  return {
    ready,
    hasPass: pass != null,
    passExpiresAt: pass?.expiresAt ?? null,
    allowance,
    gates:
      !ready && showCaddyDiagnostics(process.env)
        ? shutGates(process.env, gateInput)
        : null,
  };
}

/** Whether the caddy's tables are there at all, for the callers that only need
 * to know whether it is worth asking anything else. */
export { caddyTablesPresent };
