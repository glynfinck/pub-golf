"use client";

import { Check } from "lucide-react";

import {
  PLAN_STAGES,
  stageDone,
  stageNow,
  stageOpen,
  type PlanProgress,
  type PlanStage,
} from "@/lib/caddy/stages";
import { cn } from "@/lib/utils";

/**
 * The four acts, across the top of the room, and every one behind you is a
 * button.
 *
 * The room could always do all four; it just never said so, and it never let
 * you back. A host who drew the wrong line had to finish the plan before they
 * could redraw it, and the lock's release was an unlabelled hand icon in a
 * corner. This is the same flow with its joints showing.
 *
 * A stage ahead is deliberately not a button — its question has not been asked
 * yet, and offering it would open a screen with nothing on it. So the rail
 * reads as progress rather than as a menu, and only the road behind is open.
 */
export function StageRail({
  progress,
  onGo,
  /** Show the current act's instruction under the rail. Off where there is no
   * room for it — the gallery carries its own stage line already. */
  withHint = false,
  className,
}: {
  withHint?: boolean;
  progress: PlanProgress;
  /** Absent makes this a display rather than a control — the same four acts,
   * read-only, for a surface with nowhere to send the host back to. */
  onGo?: (stage: PlanStage) => void;
  className?: string;
}) {
  const now = stageNow(progress);
  const doing = PLAN_STAGES.find((stage) => stage.id === now)?.doing ?? "";
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", className)}>
      <div
        className={cn(
          // The rail owns its overflow rather than each caller wrapping it:
          // the room's header and the gallery's pill both mount this, and a
          // scroll rule written twice is a scroll rule that will be written
          // once. Scrollbar hidden — this is a thumb surface, not a pane.
          "w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {/*
         * **Centred by auto margins, not by `justify-center`.**
         * The four acts left-aligned inside a column that starts after the
         * back button, which put them off the page's centre by the width of
         * that button. Centring the scroll container itself is the obvious
         * fix and the wrong one: `justify-content: center` on an overflowing
         * scroller pushes the first item to a negative offset that no amount
         * of scrolling can reach, so a narrow phone would lose "Area"
         * entirely. `margin-inline: auto` on a `w-max` track centres while
         * there is room and collapses to zero when there is not.
         */}
        <div className="mx-auto flex w-max items-center gap-1">
          {PLAN_STAGES.map((stage, index) => {
            const here = stage.id === now;
            const done = stageDone(stage.id, progress);
            const open = onGo != null && stageOpen(stage.id, progress);
            return (
              <div key={stage.id} className="flex items-center gap-1">
                {index > 0 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "h-px w-1.5 shrink-0",
                      done || here ? "bg-fairway" : "bg-border",
                    )}
                  />
                ) : null}
                <button
                  type="button"
                  disabled={!open}
                  aria-current={here ? "step" : undefined}
                  // The name carries the state: a screen reader gets "Draw,
                  // done" rather than a bare label that reads the same at
                  // every stage.
                  aria-label={`${stage.label}${done ? ", done" : here ? ", current" : ", not yet"}`}
                  title={stage.doing}
                  onClick={() => onGo?.(stage.id)}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center",
                    !open && "cursor-default",
                  )}
                >
                  {/*
                   * **The hit area is 44px; the paint is not.** The button
                   * used to wear the highlight itself, so the current act was
                   * a solid green lozenge forty-four pixels tall wrapped
                   * around a ten pixel word — the tap-target floor rendered as
                   * a graphic. Same thumb target, a badge the size of its own
                   * text.
                   */}
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-full px-1.5 py-1 text-[10px] font-bold tracking-[0.1em] uppercase transition-colors",
                      here && "bg-fairway text-primary-foreground",
                      !here && done && "text-fairway",
                      !here && !done && "text-muted-foreground",
                    )}
                  >
                    {done ? <Check size={11} aria-hidden /> : null}
                    {stage.label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {/* **The act's instruction, on the glass.** `PLAN_STAGES` has carried a
        line for each of these all along and it shipped only as `title=` —
        a tooltip, which never fires on touch, on the only platform this app
        targets. So the four acts were named and never explained. */}
      {withHint && doing ? (
        <p className="truncate text-center text-[10px] text-muted-foreground">
          {doing}
        </p>
      ) : null}
    </div>
  );
}
