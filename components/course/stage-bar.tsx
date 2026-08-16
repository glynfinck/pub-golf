"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import {
  PLAN_STAGES,
  stageHead,
  type JobStage,
  type PlanProgress,
} from "@/lib/caddy/stages";
import { cn } from "@/lib/utils";

/**
 * The top bar of the caddy flow, and there is only one of it.
 *
 * **What it replaces.** Four one-word chips in a row, the current one wearing
 * a solid lozenge forty-four pixels tall around a five-letter word. Four
 * labels never fitted a 375px phone: it forced 10px type, it scrolled, and the
 * tap-target floor had to be rendered as a graphic to keep the chips
 * touchable. Naming one act at a time buys the room to say it properly —
 * "Draw the walk", not "DRAW" — and the four acts become a track that carries
 * the count without competing for space.
 *
 * **The track is status; the arrow is navigation.** That split is the whole
 * design. A 3px segment can never be a 44px target, so it does not try to be
 * one: back is a real button, and the track is free to be as quiet as it
 * likes. The cost is honest — no jumping two acts back in one tap.
 *
 * **The geometry is fixed on purpose.** 44px, flexible middle, 44px, whatever
 * either slot is holding. The room's slot is empty and the gallery's holds the
 * close button, and because both reserve the width the title sits on the
 * page's centre line in both. The arrow is disabled rather than removed where
 * there is nowhere to go back to, for the same reason: a control that vanishes
 * moves everything beside it.
 *
 * Everything it says comes from `stageHead`, so what the bar knows is provable
 * without a browser and neither screen can disagree with the other about it.
 */
export function StageBar({
  progress,
  job = "idle",
  holes = null,
  onBack,
  right,
  className,
}: {
  progress: PlanProgress;
  /** What the caddy is up to, where a job exists. */
  job?: JobStage;
  /** Holes on the landed card, so the note can stop counting steps. */
  holes?: number | null;
  /** Absent disables the arrow — the slot keeps its width regardless. */
  onBack?: () => void;
  /** The right-hand slot: the gallery's close button, or nothing. */
  right?: ReactNode;
  className?: string;
}) {
  const head = stageHead(progress, job, holes);
  const ink = head.carded ? "bg-marker" : "bg-fairway";
  return (
    <header
      className={cn(
        "shrink-0 bg-background px-4 pt-[max(env(safe-area-inset-top),10px)] pb-2",
        className,
      )}
    >
      {/* `max-w-md` matches the panel beneath it, so on anything wider than a
          phone the two pieces of furniture share one column instead of the bar
          spanning a width nothing else uses. */}
      <div className="mx-auto flex w-full max-w-md items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={!onBack}
          aria-label="Back a step"
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground disabled:opacity-40"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-serif text-lg leading-tight">
            {head.title}
          </p>
          <p className="eyebrow tabular truncate">{head.note}</p>
        </div>
        <div className="flex size-11 shrink-0 items-center justify-center">
          {right}
        </div>
      </div>

      {/* The four acts. Decorative to a screen reader — the count above says
          the same thing in words, and a reader announcing four unlabelled
          bars would only be reading the picture out. */}
      <div className="mx-auto mt-2.5 flex w-full max-w-md gap-1" aria-hidden>
        {PLAN_STAGES.map((stage, index) => {
          const inked = index < head.filled;
          const live = head.working && index === head.filled - 1;
          return (
            <span
              key={stage.id}
              className={cn(
                "h-[3px] flex-1 rounded-full transition-colors",
                inked ? ink : "bg-border",
                // The one moving thing on the screen, and only while the wire
                // is open. `motion-safe` because a pulsing bar is exactly what
                // a reduced-motion setting is asking us not to do.
                live && "motion-safe:animate-pulse",
              )}
            />
          );
        })}
      </div>

      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {head.title}. {head.note}.
      </span>
    </header>
  );
}
