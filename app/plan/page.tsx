import { redirect } from "next/navigation";

import { CaddyGates } from "@/components/course/caddy-gates";
import { CourseRoom } from "@/components/course/course-room";
import { caddyStand, caddyTablesPresent } from "@/lib/data/caddy-gate";
import { feeFiledCourse, resumeCaddy } from "@/lib/data/caddy";

/**
 * The course room — the caddy's own screen (components/course/course-room).
 *
 * Asks the server exactly what the drafting table asks: is the caddy on
 * duty, does this host hold a fee, is there a conversation to pick back up,
 * and has this fee already filed a course. One question set, two rooms —
 * a second answer to any of them is a second way for the two to disagree.
 *
 * Off duty, there is no room to stand in: a deploy with no caddy sends the
 * host to the drafting table, which has never needed one.
 */
export default async function PlanPage() {
  const stand = await caddyStand();
  if (!stand.ready) redirect("/courses/new");

  const present = await caddyTablesPresent();
  const [resumed, filed] = present
    ? await Promise.all([resumeCaddy(), feeFiledCourse()])
    : [null, null];

  return (
    <>
      <CourseRoom
        hasPass={stand.hasPass}
        allowance={stand.allowance}
        passExpiresAt={stand.passExpiresAt}
        session={resumed?.sessionId ?? null}
        filed={filed !== null}
      />
      {stand.gates ? <CaddyGates gates={stand.gates} /> : null}
    </>
  );
}
