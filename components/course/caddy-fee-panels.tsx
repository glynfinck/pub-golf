"use client";

import { CaddyMoreSheet } from "@/components/course/caddy-more-sheet";
import { GreenFeeSheet } from "@/components/round/green-fee-sheet";
import type { CaddyJobHandle } from "@/hooks/use-caddy-job";

/**
 * The two doors money is allowed to open, and the rule about when.
 *
 * Rendered beside every face the caddy can wear rather than replacing one,
 * because a refusal can arrive from the brief screen *or* mid-plan and it
 * should look the same either way. Both were written twice — once on the
 * drafting table's face and once on the room's — which is two places for one
 * covenant to be got wrong.
 *
 * **Money answers a refusal and never speaks first.** The whole of what makes
 * these legitimate is *when* they open: a host who never asks the caddy for
 * anything never sees a price on the page at all. Nothing here decides that —
 * the job's `refusal` does, and it is only ever set by a server answer or by
 * the spent panel's own door.
 */
export function CaddyRefusalSheets({
  job,
  courseId,
}: {
  job: CaddyJobHandle;
  /** The course this fee already filed, so the "more" sheet can point at it. */
  courseId?: string | null;
}) {
  return (
    <>
      <GreenFeeSheet
        open={job.refusal?.offer === "fee"}
        onOpenChange={(open) => !open && job.dismissRefusal()}
      />
      <CaddyMoreSheet
        open={job.refusal?.offer === "more"}
        onOpenChange={(open) => !open && job.dismissRefusal()}
        courseId={courseId}
        standing={job.refusal?.text ?? ""}
      />
    </>
  );
}

/**
 * A paid-up host's badge — the one state of the old fee badge that survives.
 *
 * The other state quoted a price, and that is the whole of what this cannot
 * do: a price on a screen nobody asked a question on is the covenant's own
 * counter-example.
 */
export function CoveredBadge() {
  return (
    <span className="rounded-full border border-fairway px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-fairway uppercase">
      Covered
    </span>
  );
}
