import { CaddyGates } from "@/components/course/caddy-gates";
import { CourseBuilder } from "@/components/course/course-builder";
import { caddyStand, caddyTablesPresent } from "@/lib/data/caddy-gate";
import { feeFiledCourse, resumeCaddy } from "@/lib/data/caddy";

/**
 * Kept per-request, which it was already and must stay.
 *
 * This route was dynamic for free: every path through it read the host's
 * session, and reading a session touches cookies. Short-circuiting
 * `caddyStand` on a shut caddy removed the last of those reads on that path,
 * and Next did the sensible thing with a page that suddenly asked for
 * nothing — it prerendered it at build time. The page then bakes in whichever
 * way `CADDY_OPEN` was pointing during the build and cannot be flipped back
 * without one, which is the opposite of what a switch is for.
 *
 * So it is declared rather than inherited. A rendering mode that depends on
 * whether a feature flag happens to skip a query is not a mode anyone can
 * reason about.
 */
export const dynamic = "force-dynamic";

/** The drafting table with a blank sheet on it (components/course/course-builder). */
export default async function NewCoursePage() {
  const stand = await caddyStand();

  // What the host was in the middle of, if anything. Asked here rather than
  // remembered on the client: a refresh used to lose the thread to a card that
  // was still sitting in the database, and the next plan filed a duplicate
  // course on top of it.
  //
  // Two questions, deliberately separate. `resumeCaddy` is "is there a
  // conversation to continue" and depends on the patch still being there.
  // `feeFiledCourse` is "has this fee already bought a course", which does not
  // — and answering the second from the first is what put two courses on one
  // fee (lib/data/caddy.ts).
  //
  // Both are skipped entirely while the caddy is shut on purpose: there is no
  // conversation to continue and no fee to have filed anything, so asking is
  // two round trips for a pair of nulls.
  const present = stand.comingSoon ? false : await caddyTablesPresent();
  const [resumed, filed] = present
    ? await Promise.all([resumeCaddy(), feeFiledCourse()])
    : [null, null];

  return (
    <>
      <CourseBuilder
        caddy={stand.ready}
        caddyComingSoon={stand.comingSoon}
        hasPass={stand.hasPass}
        resumed={resumed}
        filedCourseId={filed}
        passExpiresAt={stand.passExpiresAt}
        allowance={stand.allowance}
      />
      {/* Absence rather than apology stays the rule for players; this is for
          whoever is deploying, and only ever off production. */}
      {stand.gates ? <CaddyGates gates={stand.gates} /> : null}
    </>
  );
}
