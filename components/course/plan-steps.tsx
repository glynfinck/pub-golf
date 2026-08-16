"use client";

import { Check } from "lucide-react";

import { planSteps, type PlanFacts } from "@/lib/caddy/progress";
import { cn } from "@/lib/utils";

/**
 * What a step prints before it has found anything.
 *
 * A non-breaking space, so the figure column keeps its line box and the four
 * rows stay exactly as tall and as wide as each other while the numbers
 * arrive. Named and escaped rather than typed: an invisible character sitting
 * in a JSX expression is one stray edit from being deleted by somebody who
 * cannot see it.
 */
const HOLDS_THE_COLUMN = "\u00a0";

/**
 * The wait, as four steps that report what they found.
 *
 * **What it replaces: a spinner and a sentence.** A rolling ball told you a
 * model was running, which the headline already said, and the reasoning
 * underneath told you what it was thinking about but never how far along it
 * was. Neither answered the only question a host actually has while paying to
 * wait — *how much is left*.
 *
 * **And there is no busy mark beside it, deliberately.** A checklist already
 * shows work happening, in more detail than any mark can; a spinner alongside
 * would be a second thing saying the same thing. The house `Putt` keeps every
 * other wait in the app — the ones with nothing else to show.
 *
 * The honest cost of that trade is real and worth writing down: if a step
 * stalls, nothing on this screen moves, and a frozen screen reads as broken
 * faster than a slow one. What stops it being frozen is the live figure on
 * the picking row, which counts up through the longest part of the wait.
 *
 * Every step and every figure comes from `planSteps`, which is pure — so what
 * this claims about a plan is provable without a browser and without a model.
 */
export function PlanSteps({
  facts,
  className,
}: {
  facts: PlanFacts;
  className?: string;
}) {
  const steps = planSteps(facts);
  return (
    <ol
      className={cn("flex flex-col gap-1.5", className)}
      // The count above is the announcement; reading four rows aloud on every
      // tick would bury it.
      aria-label="What the caddy has done so far"
    >
      {steps.map((step) => (
        <li
          key={step.id}
          className={cn(
            "flex items-center gap-2 text-[11px] transition-opacity duration-500",
            step.state === "todo" && "opacity-35",
            step.state === "now" && "font-bold text-fairway",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
              step.state === "done" &&
                "border-fairway bg-fairway text-primary-foreground",
              step.state === "now" && "border-marker bg-marker",
              step.state === "todo" && "border-border",
            )}
          >
            {step.state === "done" ? <Check className="size-2.5" /> : null}
          </span>
          <span className="min-w-0 truncate">{step.label}</span>
          {/* The figure, and the whole argument for this over a tick. Right
              aligned so the four of them read down a column as a receipt
              rather than as four sentences of different lengths. */}
          <span
            className={cn(
              "tabular ml-auto shrink-0 text-[10px] transition-opacity duration-500",
              step.found ? "opacity-100" : "opacity-0",
              step.state === "now" ? "text-marker" : "text-muted-foreground",
            )}
          >
            {step.found ?? HOLDS_THE_COLUMN}
          </span>
        </li>
      ))}
    </ol>
  );
}
