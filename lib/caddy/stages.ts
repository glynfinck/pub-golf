/**
 * The four acts of building a route, named — and made walkable in both
 * directions.
 *
 * The room had all four already and admitted to none of them. Choosing an
 * area, drawing the walk, tuning the brief and letting the caddy enrich it are
 * genuinely different jobs with different controls, and they were distinguished
 * only by which button happened to be on screen. Going *back* was worse: the
 * lock had a release nobody would find, redrawing meant hunting a chip, and
 * once a plan was running there was no way to say "not like that".
 *
 * Pure, so what a stage *is* stays provable and the room only has to render it:
 * the progress a host has made is four booleans, and everything else here is a
 * function of them.
 */

export type PlanStage = "area" | "draw" | "tune" | "enrich";

export const PLAN_STAGES: {
  id: PlanStage;
  label: string;
  /** What this act is for, in the one line the rail has room for. */
  doing: string;
}[] = [
  {
    id: "area",
    label: "Area",
    doing: "Move the map to where the night is, then hold it still.",
  },
  {
    id: "draw",
    label: "Draw",
    doing: "Draw the walk. The bright ground is where the pubs are thick.",
  },
  {
    id: "tune",
    label: "Tune",
    doing: "Holes, character, and when you tee off.",
  },
  {
    id: "enrich",
    label: "Enrich",
    doing: "The caddy picks the pubs and dresses the card.",
  },
];

const ORDER: PlanStage[] = PLAN_STAGES.map((stage) => stage.id);

/** Everything the room knows about how far the host has got. */
export interface PlanProgress {
  /** The map is held still, so there is a frame to draw on. */
  locked: boolean;
  /** Somewhere to aim: a walk drawn, or a patch named in the brief. */
  aimed: boolean;
  /** The caddy is working, or its menu is up. */
  planning: boolean;
  /** A card has landed. */
  carded: boolean;
}

/** Which act the host is in. */
export function stageNow(progress: PlanProgress): PlanStage {
  if (progress.carded || progress.planning) return "enrich";
  if (progress.aimed) return "tune";
  if (progress.locked) return "draw";
  return "area";
}

/** Whether an act is behind the host — what the rail ticks. */
export function stageDone(stage: PlanStage, progress: PlanProgress): boolean {
  return ORDER.indexOf(stage) < ORDER.indexOf(stageNow(progress));
}

/**
 * Whether an act can be jumped to from here.
 *
 * **Back is the whole point**, so back is nearly always open: the complaint
 * this answers is that a host who has drawn the wrong line has to finish the
 * plan before they can redraw it. Forward is not, and deliberately — a stage
 * ahead is one whose question has not been answered yet, and a rail that let
 * you skip to it would be offering a screen with nothing on it.
 *
 * The one closed door is going back out of a plan already in flight. There is
 * nothing to go back *to* until it lands or fails, the fee is already spent,
 * and a half-cancelled plan is the state this codebase has spent the most
 * effort never having.
 */
export function stageOpen(stage: PlanStage, progress: PlanProgress): boolean {
  const now = stageNow(progress);
  if (stage === now) return true;
  const behind = ORDER.indexOf(stage) < ORDER.indexOf(now);
  if (!behind) return false;
  return !progress.planning || progress.carded;
}

/**
 * What stepping back to a stage has to undo.
 *
 * Named here rather than decided at three call sites, because "back" means
 * something specific each time and getting it wrong throws away work: going
 * back to Draw must keep the frame the host lined up, and going back to Tune
 * must keep the line they drew. Only Area drops both, because only Area is
 * asking a question that a frame is the answer to.
 */
export interface StageUndo {
  /** Let the map move again. */
  release: boolean;
  /** Drop the drawn walk. */
  clearStroke: boolean;
}

export function undoFor(stage: PlanStage): StageUndo {
  if (stage === "area") return { release: true, clearStroke: true };
  if (stage === "draw") return { release: false, clearStroke: true };
  return { release: false, clearStroke: false };
}
