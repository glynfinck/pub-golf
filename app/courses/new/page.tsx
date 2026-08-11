import { CaddyGates } from "@/components/course/caddy-gates";
import { CourseBuilder } from "@/components/course/course-builder";
import {
  caddyReady,
  showCaddyDiagnostics,
  shutGates,
} from "@/lib/caddy/readiness";
import { caddyAllowance, resumeCaddy } from "@/lib/data/caddy";
import { getDayPass } from "@/lib/data/billing";
import { getSessionUser } from "@/lib/data/rounds";
import { createClient } from "@/lib/supabase/server";

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

/** The drafting table with a blank sheet on it (components/course/course-builder). */
export default async function NewCoursePage() {
  const [pass, user, tablesPresent] = await Promise.all([
    getDayPass(),
    getSessionUser(),
    caddyTablesPresent(),
  ]);

  // What the host was in the middle of, if anything. Asked here rather than
  // remembered on the client: a refresh used to lose the thread to a card that
  // was still sitting in the database, and the next plan filed a duplicate
  // course on top of it (`lib/data/caddy.ts`).
  const [resumed, allowance] = tablesPresent
    ? await Promise.all([resumeCaddy(), caddyAllowance()])
    : [null, { canPlan: true, courseId: null }];

  const gateInput = {
    signedIn: user != null,
    anonymous: user?.is_anonymous === true,
    hasPass: pass != null,
    tablesPresent,
  };
  const ready = caddyReady(process.env, gateInput);

  return (
    <>
      <CourseBuilder
        caddy={ready}
        hasPass={pass != null}
        resumed={resumed}
        allowance={allowance}
      />
      {/* Absence rather than apology stays the rule for players; this is for
          whoever is deploying, and only ever off production. */}
      {!ready && showCaddyDiagnostics(process.env) ? (
        <CaddyGates gates={shutGates(process.env, gateInput)} />
      ) : null}
    </>
  );
}
