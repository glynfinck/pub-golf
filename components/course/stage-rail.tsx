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
  className,
}: {
  progress: PlanProgress;
  /** Absent makes this a display rather than a control — the same four acts,
   * read-only, for a surface with nowhere to send the host back to. */
  onGo?: (stage: PlanStage) => void;
  className?: string;
}) {
  const now = stageNow(progress);
  return (
    <div
      className={cn(
        // The rail owns its overflow rather than each caller wrapping it:
        // the room's header and the gallery's pill both mount this, and a
        // scroll rule written twice is a scroll rule that will be written
        // once. Scrollbar hidden — this is a thumb surface, not a pane.
        "flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {PLAN_STAGES.map((stage, index) => {
        const here = stage.id === now;
        const done = stageDone(stage.id, progress);
        const open = onGo != null && stageOpen(stage.id, progress);
        return (
          <div key={stage.id} className="flex min-w-0 items-center gap-1">
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
              // The name carries the state: a screen reader gets "Draw, done"
              // rather than a bare label that reads the same at every stage.
              aria-label={`${stage.label}${done ? ", done" : here ? ", current" : ", not yet"}`}
              title={stage.doing}
              onClick={() => onGo?.(stage.id)}
              className={cn(
                "flex min-h-9 shrink-0 items-center gap-1 rounded-full px-2 text-[10px] font-bold tracking-[0.1em] uppercase transition-colors",
                here && "bg-fairway text-primary-foreground",
                !here && done && "text-fairway hover:bg-secondary",
                !here && !done && "text-muted-foreground",
                !open && "cursor-default",
              )}
            >
              {done ? <Check size={11} aria-hidden /> : null}
              {stage.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
