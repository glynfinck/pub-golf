import { CaddyGates } from "@/components/course/caddy-gates";
import { CourseBuilder } from "@/components/course/course-builder";
import { caddyStand, caddyTablesPresent } from "@/lib/data/caddy-gate";
import { feeFiledCourse, resumeCaddy } from "@/lib/data/caddy";

/** The drafting table with a blank sheet on it (components/course/course-builder). */
export default async function NewCoursePage({
  searchParams,
}: {
  searchParams: Promise<{ caddy?: string }>;
}) {
  /**
   * **Resuming is a deliberate act, not an ambient one.**
   *
   * `resumeCaddy` answers "your most recent open conversation" and does not
   * care how you got here — so a host who chose *plot it by hand* was handed
   * the caddy's last card, pre-filled, with the caddy's own panel above it.
   * The table was doing exactly what it was told; nobody had told it that
   * arriving by the manual door means something.
   *
   * Now the room says so in the URL. `?caddy=1` is what the course room's
   * hand-over carries, and it is the only thing that reopens a conversation
   * here — a refresh keeps it, so the thread still survives one. Without it
   * this is a blank table with no caddy on it, which is the whole of what
   * "by hand" has to mean to be worth choosing. The conversation is not lost
   * either way: the chooser offers to carry it on, by name.
   */
  const { caddy: continuing } = await searchParams;
  const carryOn = continuing === "1";

  const stand = await caddyStand();

  // Two questions, deliberately separate. `resumeCaddy` is "is there a
  // conversation to continue" and depends on the patch still being there.
  // `feeFiledCourse` is "has this fee already bought a course", which does not
  // — and answering the second from the first is what put two courses on one
  // fee (lib/data/caddy.ts).
  const present = carryOn ? await caddyTablesPresent() : false;
  const [resumed, filed] = present
    ? await Promise.all([resumeCaddy(), feeFiledCourse()])
    : [null, null];

  return (
    <>
      <CourseBuilder
        caddy={stand.ready && carryOn}
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
