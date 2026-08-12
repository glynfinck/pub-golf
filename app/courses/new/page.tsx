import { CaddyGates } from "@/components/course/caddy-gates";
import { CourseBuilder } from "@/components/course/course-builder";
import { caddyStand, caddyTablesPresent } from "@/lib/data/caddy-gate";
import { feeFiledCourse, resumeCaddy } from "@/lib/data/caddy";

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
  const present = await caddyTablesPresent();
  const [resumed, filed] = present
    ? await Promise.all([resumeCaddy(), feeFiledCourse()])
    : [null, null];

  return (
    <>
      <CourseBuilder
        caddy={stand.ready}
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
