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
  /** The one-word name, for anywhere four of them stand in a row. */
  label: string;
  /**
   * The act as an instruction, which is what the top bar shows.
   *
   * Four one-word labels never fitted a 375px phone — that is what forced
   * 10px type, a 44px lozenge around a five-letter word, and a bar that
   * scrolled. Showing one act at a time buys the room to say it properly:
   * "Draw the walk" rather than "DRAW".
   */
  title: string;
  /** What this act is for, in the one line the bar has room for. */
  doing: string;
}[] = [
  {
    id: "area",
    label: "Area",
    title: "Pick the area",
    doing: "Move the map to where the night is, then hold it still.",
  },
  {
    id: "draw",
    label: "Draw",
    title: "Draw the walk",
    doing: "Draw the walk. The bright ground is where the pubs are thick.",
  },
  {
    id: "tune",
    label: "Tune",
    title: "Tune the brief",
    doing: "Holes, character, and when you tee off.",
  },
  {
    id: "enrich",
    label: "Enrich",
    title: "The caddy’s turn",
    doing: "The caddy picks the pubs and dresses the card.",
  },
];

const ORDER: PlanStage[] = PLAN_STAGES.map((stage) => stage.id);

/** How many acts there are. The bar counts against this, never against 4. */
export const STEP_COUNT = PLAN_STAGES.length;

/**
 * What the caddy's job is doing, and the one question worth asking about it.
 *
 * The gallery's stage and "is a request in flight" are different facts, and
 * reading one for the other is what broke the course room: the stage *label*
 * is non-null at `menu` (a walk is waiting to be picked) and at `failed` (an
 * apology is waiting to be read), neither of which is a plan running. The room
 * closed the road back on any label at all, so the rail went dead the moment
 * the menu arrived and stayed dead through a refusal — which, with the
 * fullscreen gallery closing itself on the way out, is exactly the "I pressed
 * it and nothing happened" that this pair of functions exists to prevent.
 *
 * One definition, read by the group that reports it and the gallery that
 * draws it, so they cannot drift apart again.
 */
export type JobStage =
  /**
   * Nothing has been asked for yet.
   *
   * **This stage exists because its absence was a bug.** A fresh job started at
   * `opening`, which is a *request in flight* — so `jobWorking` answered true
   * before the host had typed anything, the room's rail pinned itself to Enrich
   * the moment it mounted, every act behind it was disabled (a stage behind a
   * plan in flight is deliberately closed), and the drafting table painted
   * "Walking the patch" over a map with nothing on it. One stage doing two jobs,
   * and the second one was a lie the whole flow read.
   */
  | "idle"
  | "opening"
  | "menu"
  | "dressing"
  | "done"
  | "failed";

/** Where a job that has never run sits. */
export const JOB_START: JobStage = "idle";

export function jobWorking(stage: JobStage): boolean {
  return stage === "opening" || stage === "dressing";
}

/**
 * What each stage is called, on each of the three surfaces that name it.
 *
 * One truth, written four times, was the shape this arrived in: a badge on the
 * drafting table's map, a headline over the gallery, a line on the minimised
 * pill, and a label on the panel's tab — each its own literal in its own file,
 * none of them exhaustive over the stage list. Adding a stage meant finding
 * four places or shipping a blank.
 *
 * The tab is gone: it is a grabber over three fixed figures now, because five
 * different wordings on the control a host reaches for most was the whole
 * complaint. Three remain, and they stay **deliberately different**: the pill
 * is read from another screen and has to say what to do about it; the badge
 * sits on a map and has a map's room; the headline is read while watching.
 * Flattening them into one string would be a regression, not a tidy-up.
 */
export const JOB_BADGE: Record<JobStage, string | null> = {
  // Nothing has been asked for, so the map says nothing. A badge here read as
  // work already under way over an empty table.
  idle: null,
  opening: "Walking the patch",
  menu: "Walks ready",
  dressing: "Dressing the card",
  done: null,
  failed: "The caddy lost the ball",
};

/**
 * The caddy's own voice, and the top bar's title once it has the ball.
 *
 * Sized for that row, which is the one constraint it did not have when it was
 * a pill floating over the map: at 18px serif between two 44px slots, a title
 * longer than about thirty characters truncates on a 360px phone. `menu` was
 * thirty-two — and the half that made it long ("or let the caddy") is a button
 * six rows below it, so the row was spending its width restating a control the
 * host can already see.
 */
export const JOB_HEADLINE: Record<JobStage, string> = {
  idle: "The caddy’s ready",
  opening: "The caddy’s walking the patch",
  menu: "Pick the walk",
  dressing: "The caddy’s dressing the card",
  done: "On the table",
  failed: "The caddy lost the ball",
};

/** Null where there is nothing worth interrupting another screen for. */
export const JOB_PILL: Record<JobStage, string | null> = {
  idle: null,
  opening: "The caddy’s walking the patch",
  menu: "Walks ready — come pick one",
  dressing: "The caddy’s dressing the card",
  done: null,
  failed: "The caddy lost the ball — take a look",
};

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

/**
 * Where a back tap lands — the nearest act behind that is open.
 *
 * Null means there is nothing to step back to, which happens in two places:
 * the first act, and a plan already in flight. The caller decides what back
 * means then (leave the room, or nothing), but the *arrow keeps its 44px
 * either way* — a control that disappears is a control that moves everything
 * beside it.
 */
export function stageBack(progress: PlanProgress): PlanStage | null {
  const from = ORDER.indexOf(stageNow(progress));
  for (let index = from - 1; index >= 0; index -= 1) {
    if (stageOpen(ORDER[index], progress)) return ORDER[index];
  }
  return null;
}

/**
 * The top bar, said once.
 *
 * The bar is the only thing on either screen that answers "where am I" — so
 * it is one function, and both screens render whatever it returns. The room's
 * header and the gallery's used to be two different objects with six
 * differences between them: one floated, one didn't; one had the instruction,
 * one had a headline pill; and the gallery hard-coded its own ticks, so the
 * same moment read differently on the two surfaces.
 */
export interface StageHead {
  /** The act, or what the caddy is doing if it has taken over. */
  title: string;
  /** The count beneath it — the only place a number appears. */
  note: string;
  /** How many of the acts are inked, 1-based and inclusive of the current. */
  filled: number;
  /** The last inked segment is a plan on the wire. */
  working: boolean;
  /** A card landed: the whole track goes to marker ink. */
  carded: boolean;
}

export function stageHead(
  progress: PlanProgress,
  job: JobStage = "idle",
  /** Holes on the card, once there is one — the count earns the row that
   * "Step 4 of 4" would otherwise keep saying after there are no steps left. */
  holes: number | null = null,
): StageHead {
  const step = ORDER.indexOf(stageNow(progress)) + 1;
  const working = jobWorking(job);
  return {
    // The caddy speaks for itself once it has the ball; before that the act
    // is the title. `JOB_HEADLINE` is that voice already — reusing it is what
    // keeps this from becoming a fifth wording of the same five stages.
    title: job === "idle" ? PLAN_STAGES[step - 1].title : JOB_HEADLINE[job],
    note: progress.carded
      ? holes != null
        ? `${holes} holes · on the table`
        : "On the table"
      : working
        ? `Step ${step} of ${STEP_COUNT} · working`
        : `Step ${step} of ${STEP_COUNT}`,
    filled: step,
    working,
    carded: progress.carded,
  };
}
