"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { FieldLabel, Input } from "@/components/ui/input";
import { PendingLabel } from "@/components/ui/pending-label";
import { CaddyTicker } from "@/components/course/caddy-waiting";
import { CaddyRefusalSheets } from "@/components/course/caddy-fee-panels";
import { CaddyUsage } from "@/components/course/caddy-usage";
import { useAction } from "@/hooks/use-action";
import type { CaddyJobHandle } from "@/hooks/use-caddy-job";
import { askTheCaddy, reopenCaddyPatch } from "@/lib/actions/caddy";
import { CADDY_CREDITS_SPENT, feeIsSpent } from "@/lib/caddy/credits";
import type { PlannedCourse } from "@/lib/caddy/plan";
import { cn } from "@/lib/utils";

/**
 * The caddy on the drafting table: its two verbs, once a card exists.
 *
 * **This was five faces and a mode flag.** One component held the brief, the
 * collapsed teaser, the wait, the ask box and the spent-fee panel, and chose
 * between them with a chain of early returns — four of which never read the
 * `room` boolean they were supposed to answer to. So the Course Room, whose
 * only business is the brief, got the *table's* ask box whenever the host had
 * planned anything in the last twelve hours: an ask box over an empty map,
 * with no brief, no Plan button and no card. `/plan` could not plan.
 *
 * The brief is `components/course/brief-form.tsx` now and this is the table's
 * face alone. Each room composes the one it wants; there is no flag and no
 * shared chain to fall through.
 *
 * The card this produces belongs to the builder, because a caddy-planned
 * course is a draft on the same table as a hand-plotted one and every edit is
 * the same.
 */
export function CaddyAsk({
  job,
  hasPass,
  onCourse,
  onTurn,
  allowance,
  reopen = null,
  className,
}: {
  /** The job, owned by the table — see `hooks/use-caddy-job.ts`. */
  job: CaddyJobHandle;
  hasPass: boolean;
  onCourse: (course: PlannedCourse, changed: number[]) => void | Promise<void>;
  onTurn?: (turnId: string | null) => void;
  allowance?: { canPlan: boolean; left: number; courseId: string | null };
  /** A conversation whose patch has been swept, and the id it lives under. */
  reopen?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const { run, pending, busy } = useAction();
  const [ask, setAsk] = useState("");

  function say(input: { ask?: string; roll?: boolean }) {
    const asking = job.sessionId;
    if (!asking) return;
    run(async () => {
      const result = await askTheCaddy({ sessionId: asking, ...input });
      if (result.error) return { error: result.error, detail: result.detail };
      if (result.course) {
        onTurn?.(result.turnId ?? null);
        await onCourse(result.course, result.changed ?? []);
      }
      setAsk("");
      return {};
    });
  }

  /** Both money doors, beside every face — a refusal can arrive from any of
   * them and should look the same either way. */
  const sheets = (
    <CaddyRefusalSheets job={job} courseId={allowance?.courseId} />
  );

  /**
   * The gallery overlay, rendered from every face the group can wear: the
   * plan crosses several of them (form → wait → ask box) and the overlay must
   * survive each transition. A portal, so it costs the layout nothing.
   */
  // ——— The wait. Narrated, never spun: the line names the stage the
  // pipeline is actually in, and the Putt is the house's own busy animation.
  if (pending) {
    return (
      <div
        className={cn(
          "engraved flex flex-col items-center gap-3 rounded-xl bg-card px-4 py-6",
          className,
        )}
      >
        <CaddyTicker
          headline="The caddy’s thinking"
          doing={job.doing}
          thinking={job.thinking}
          fallback="Won’t be a moment."
        />
      </div>
    );
  }

  // ——— The card is here and the patch is not. Offered rather than done
  // automatically: it is a call out to Google, and a host who only came to
  // rename a hole should not pay for one they never asked for.
  if (!job.sessionId && reopen) {
    return (
      <div
        className={cn(
          "engraved flex flex-col gap-2.5 rounded-xl bg-card px-4 py-3.5",
          className,
        )}
      >
        {sheets}
        <span className="eyebrow text-fairway">The caddy</span>
        <p className="text-xs text-muted-foreground">
          The caddy has put this patch away for the night. Fetch it back and you
          can carry on changing the card — it costs nothing off your fee.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await reopenCaddyPatch(reopen);
              if (result.error) return result;
              // The patch is on the session now; the page reads it on the way
              // back in, which is also what puts the ask box on screen.
              router.refresh();
              return {};
            })
          }
        >
          <PendingLabel
            pending={pending}
            busy={busy}
            label="Pick this back up"
            pendingLabel="Bringing it back"
          />
        </Button>
      </div>
    );
  }

  // ——— On the table: the caddy's two verbs, once a card exists. No count
  // anywhere — the caddy is not rationed on screen.
  if (job.sessionId) {
    return (
      <div
        className={cn(
          "engraved flex flex-col gap-2.5 rounded-xl bg-card px-4 py-3.5",
          className,
        )}
      >
        {sheets}
        <span className="eyebrow text-fairway">The caddy</span>
        <div>
          <FieldLabel htmlFor="caddy-ask">Tell the caddy</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id="caddy-ask"
              value={ask}
              onChange={(event) => setAsk(event.target.value.slice(0, 200))}
              placeholder="More gardens in the back half"
            />
            <Button
              size="compact"
              variant="outline"
              className="h-12 shrink-0"
              disabled={!ask.trim() || busy}
              onClick={() => say({ ask: ask.trim() })}
            >
              Ask
            </Button>
          </div>
        </div>
        <Button
          variant="outline"
          size="compact"
          className="h-11 w-full"
          disabled={busy}
          onClick={() => say({ roll: true })}
        >
          Roll a fresh card
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Ask as often as you like — it&apos;s the same patch, so the caddy is
          quick about it. Every pub is one that&apos;s really there; swap any of
          them below.
        </p>
      </div>
    );
  }

  // ——— The fee has its course. Not a wall and not a price: a door to the
  // thing they already own, and the two free ways on. The drafting table below
  // is untouched — the manual builder never cost anything and still does not,
  // which is the sentence this panel exists to make sure nobody misses.
  //
  // Through `feeIsSpent`, because the condition here used to be the allowance
  // alone — and an empty allowance is what a spent fee and a fee nobody ever
  // bought both look like. That put this panel, its "this green fee has
  // planned all its courses" and its door to the top-up shelf in front of
  // hosts who had never paid for anything. See `feeIsSpent` for the whole of
  // it; with no pass the group falls through to the brief, where asking for a
  // course is answered with the green fee.
  if (
    allowance &&
    feeIsSpent({ hasPass, canPlan: allowance.canPlan }) &&
    !job.sessionId
  ) {
    return (
      <div
        className={cn(
          "engraved flex flex-col gap-2 rounded-xl bg-card px-4 py-3.5",
          className,
        )}
        data-testid="caddy-spent"
      >
        {sheets}
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow text-fairway">The caddy</span>
          <CaddyUsage left={0} />
        </div>
        {/* This said "the caddy plans three to a green fee" — a number that
            was `caddy_courses_per_fee()` before the ledger dropped it, sitting
            two lines under a row of five pips. The sentence that owns the
            allowance is written beside the allowance now, and there is only
            one of it. */}
        <p className="text-xs text-muted-foreground">{CADDY_CREDITS_SPENT}</p>
        {allowance.courseId ? (
          <Link
            href={`/courses/${allowance.courseId}`}
            className={cn(
              buttonVariants({ variant: "outline", size: "compact" }),
              "h-11 w-full",
            )}
          >
            Open your course
          </Link>
        ) : null}
        {/* The door that was missing. A host who spent their fee, closed the
            tab and came back met this panel — which mounted the sheet and
            never opened it, so the top-ups were reachable only by someone
            whose allowance read as available and was then refused. The sheet
            still only opens because they asked. */}
        <button
          type="button"
          onClick={() =>
            job.showRefusal({ text: CADDY_CREDITS_SPENT, offer: "more" })
          }
          className="min-h-11 text-[11px] font-semibold text-muted-foreground hover:text-fairway"
        >
          Have the caddy plan more
        </button>
        <p className="text-[10px] text-muted-foreground">
          Plotting one by hand below is free, as always.
        </p>
      </div>
    );
  }

  /**
   * Nothing to say.
   *
   * The table mounts this only with a session or a patch to reopen, so in
   * practice one of the faces above always answers. An explicit null is the
   * honest fifth: the brief that used to live here is the Course Room's now
   * (`components/course/brief-form.tsx`), and a component that fell through to
   * a form the table never showed was the shape that hid `/plan`'s bug.
   */
  return null;
}
