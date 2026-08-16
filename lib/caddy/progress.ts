import type { JobStage } from "@/lib/caddy/stages";

/**
 * The plan's real milestones, and what each one found.
 *
 * **Every step here is a thing that actually happens, and every figure is a
 * number the client already has.** That constraint is the whole design. The
 * caddy is a *tool loop*, not a pipeline: it may search Places three times,
 * route twice and rule a pub out once, in whatever order it likes. A fixed
 * list of five named stages would have been theatre — a progress bar with
 * invented labels, which is worse than a spinner because it claims to know
 * something.
 *
 * What *is* stable is the shape of a plan: a patch is gathered before the model
 * is called at all, pubs are chosen out of it, those pubs make a walk, and a
 * card is written. Four milestones, each with a figure that falls out of events
 * the stream already sends — the patch pins, the picks, the card. Nothing new
 * on the wire, and nothing the caddy has to remember to announce.
 *
 * **The figure is the point.** "41 pubs read" is the work; "done" is only its
 * shadow. A tick tells you a step finished and nothing about what it found, and
 * by the end these four rows are a receipt of what the caddy actually did.
 */

export type StepState = "done" | "now" | "todo";

export interface PlanStep {
  id: "patch" | "pick" | "walk" | "card";
  label: string;
  /** What it found, once it has found it. Null until then — never a guess. */
  found: string | null;
  state: StepState;
}

export interface PlanFacts {
  stage: JobStage;
  /** Pubs in the gathered patch — the `patch` event's own count. */
  candidates: number;
  /** Pubs the caddy has named so far, from the `picked` events. */
  picked: number;
  /** Holes the host asked for. What `picked` is counting towards. */
  holes: number;
  /** The walk through the picks so far, where there is enough to measure. */
  km: number | null;
  /** Holes on the landed card. Null until one lands. */
  carded: number | null;
}

/** How many are behind you — what a caller counts to show progress. */
export function stepsDone(steps: PlanStep[]): number {
  return steps.filter((step) => step.state === "done").length;
}

export function planSteps(facts: PlanFacts): PlanStep[] {
  const { stage, candidates, picked, holes, km, carded } = facts;
  const finished = carded != null;
  // The patch is gathered before the model is called, so by the time anything
  // is dressing it is done by definition — but the count only exists once the
  // `patch` event has landed.
  const gathered = candidates > 0;
  const picking = gathered && !finished;
  const allPicked = picked >= holes && holes > 0;

  const step = (
    id: PlanStep["id"],
    label: string,
    found: string | null,
    done: boolean,
    now: boolean,
  ): PlanStep => ({
    id,
    label,
    found,
    state: done ? "done" : now ? "now" : "todo",
  });

  return [
    step(
      "patch",
      "Read the patch",
      gathered ? `${candidates} pubs` : null,
      gathered,
      stage === "opening" && !gathered,
    ),
    step(
      "pick",
      "Choose the pubs",
      // Counting up while it happens, which is the one row where the figure
      // moves — and the row the wait is mostly spent on.
      picked > 0 ? `${picked} of ${candidates}` : null,
      finished || allPicked,
      picking && !allPicked,
    ),
    step(
      "walk",
      "Walk the order",
      // Only once the picks are all in. A caller may well have a running
      // figure before then — the walk through four of nine pubs is a real
      // measurement — but printing it on a row that has not started reads as
      // a result, and it is about to change. The picking row above is what
      // moves during the wait; this one has nothing to prove until it is true.
      allPicked && km != null ? `${km.toFixed(1)} km` : null,
      finished || (allPicked && km != null),
      picking && allPicked,
    ),
    step(
      "card",
      "Dress the card",
      carded != null ? `${carded} holes` : null,
      finished,
      !finished && allPicked,
    ),
  ];
}
