import { describe, expect, it } from "vitest";

import {
  planSteps,
  stepsDone,
  type PlanFacts,
  type PlanStep,
} from "@/lib/caddy/progress";

/**
 * A checklist has to be true or it is worse than a spinner.
 *
 * The caddy is a tool loop — it may search Places three times, route twice and
 * rule a pub out once, in whatever order it likes. So a fixed list of named
 * stages would be invented, and an invented step that stalls is a lie the host
 * can watch. These hold the rule that keeps it honest: every step is a thing
 * that happens, every figure is a number the client already has, and nothing
 * claims to have found something it has not.
 */

const START: PlanFacts = {
  stage: "opening",
  candidates: 0,
  picked: 0,
  holes: 9,
  km: null,
  carded: null,
};

const byId = (steps: PlanStep[]) =>
  Object.fromEntries(steps.map((step) => [step.id, step]));

describe("the steps themselves", () => {
  it("is the same four, in the same order, always", () => {
    // The list may not reorder or grow under the reader — that is the whole
    // difference between a checklist and a log.
    for (const facts of [
      START,
      { ...START, stage: "dressing" as const, candidates: 41, picked: 4 },
      {
        ...START,
        stage: "done" as const,
        candidates: 41,
        picked: 9,
        carded: 9,
      },
    ]) {
      expect(planSteps(facts).map((step) => step.id)).toEqual([
        "patch",
        "pick",
        "walk",
        "card",
      ]);
    }
  });

  it("never has two steps live at once", () => {
    const sweeps: PlanFacts[] = [
      START,
      { ...START, candidates: 41 },
      { ...START, stage: "dressing", candidates: 41, picked: 3 },
      { ...START, stage: "dressing", candidates: 41, picked: 9, km: 2.9 },
      {
        ...START,
        stage: "done",
        candidates: 41,
        picked: 9,
        km: 2.9,
        carded: 9,
      },
    ];
    for (const facts of sweeps) {
      const now = planSteps(facts).filter((step) => step.state === "now");
      expect(`${facts.picked}/${facts.carded}: ${now.length}`).toBe(
        `${facts.picked}/${facts.carded}: ${now.length <= 1 ? now.length : "many"}`,
      );
      expect(now.length).toBeLessThanOrEqual(1);
    }
  });

  it("moves forwards only", () => {
    // Done never goes back to todo as the plan proceeds.
    const timeline: PlanFacts[] = [
      START,
      { ...START, candidates: 41 },
      { ...START, stage: "dressing", candidates: 41, picked: 1 },
      { ...START, stage: "dressing", candidates: 41, picked: 5 },
      { ...START, stage: "dressing", candidates: 41, picked: 9, km: 2.9 },
      {
        ...START,
        stage: "done",
        candidates: 41,
        picked: 9,
        km: 2.9,
        carded: 9,
      },
    ];
    let last = 0;
    for (const facts of timeline) {
      const done = stepsDone(planSteps(facts));
      expect(done).toBeGreaterThanOrEqual(last);
      last = done;
    }
    expect(last).toBe(4);
  });
});

describe("what each step reports", () => {
  it("says nothing before it has found anything", () => {
    // The rule that keeps it from being theatre: no figure is a guess.
    for (const step of planSteps(START)) {
      expect(`${step.id}: ${step.found}`).toBe(`${step.id}: null`);
    }
  });

  it("counts the patch as the gather answers it", () => {
    const steps = byId(planSteps({ ...START, candidates: 41 }));
    expect(steps.patch.found).toBe("41 pubs");
    expect(steps.patch.state).toBe("done");
  });

  it("counts the picks against the patch, while it happens", () => {
    // The one row whose figure moves — and the row the wait is mostly spent
    // on, which is why it is the one that counts up rather than ticking once.
    const at = (picked: number) =>
      byId(planSteps({ ...START, stage: "dressing", candidates: 41, picked }))
        .pick;
    expect(at(0).found).toBeNull();
    expect(at(1).found).toBe("1 of 41");
    expect(at(6).found).toBe("6 of 41");
    expect(at(6).state).toBe("now");
    expect(at(9).state).toBe("done");
  });

  it("measures the walk only once there is one", () => {
    // A running figure is offered here — the walk through four of the nine is
    // a real measurement — and it is still withheld, because a number on a row
    // that has not started reads as that row's result and is about to change.
    const half = byId(
      planSteps({
        ...START,
        stage: "dressing",
        candidates: 41,
        picked: 4,
        km: 1.2,
      }),
    );
    expect(half.walk.found).toBeNull();
    expect(half.walk.state).toBe("todo");
    const whole = byId(
      planSteps({
        ...START,
        stage: "dressing",
        candidates: 41,
        picked: 9,
        km: 2.94,
      }),
    );
    expect(whole.walk.found).toBe("2.9 km");
  });

  it("counts the card's own holes, not the ones that were asked for", () => {
    // A card can land short — the figure has to be what arrived.
    const steps = byId(
      planSteps({
        ...START,
        stage: "done",
        candidates: 41,
        picked: 9,
        km: 2.9,
        carded: 7,
      }),
    );
    expect(steps.card.found).toBe("7 holes");
  });
});

describe("the ending", () => {
  it("finishes every step when a card lands", () => {
    const steps = planSteps({
      stage: "done",
      candidates: 41,
      picked: 9,
      holes: 9,
      km: 2.9,
      carded: 9,
    });
    expect(steps.every((step) => step.state === "done")).toBe(true);
    expect(stepsDone(steps)).toBe(4);
  });

  it("finishes them even where the picks were never announced", () => {
    // `picked` is narration and may not arrive at all — a card is still a
    // finished plan, and a list left half-ticked over one would be a lie.
    const steps = planSteps({
      stage: "done",
      candidates: 41,
      picked: 0,
      holes: 9,
      km: null,
      carded: 9,
    });
    expect(stepsDone(steps)).toBe(4);
  });

  it("reads as a receipt by the end", () => {
    const steps = planSteps({
      stage: "done",
      candidates: 41,
      picked: 9,
      holes: 9,
      km: 2.9,
      carded: 9,
    });
    expect(steps.map((step) => step.found)).toEqual([
      "41 pubs",
      "9 of 41",
      "2.9 km",
      "9 holes",
    ]);
  });
});
