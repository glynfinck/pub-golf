import { describe, expect, it } from "vitest";

import {
  PLAN_STAGES,
  stageDone,
  stageNow,
  stageOpen,
  undoFor,
  type PlanProgress,
  type PlanStage,
} from "@/lib/caddy/stages";

/**
 * Going back, which the room could not do at all.
 *
 * The rules worth holding are the ones about *not losing work*: stepping back
 * to Draw must keep the frame the host lined up, stepping back to Tune must
 * keep the line they drew, and a plan already in flight must not be
 * steppable-out-of, because the fee is spent and there is nothing behind it
 * yet.
 */

const NOTHING: PlanProgress = {
  locked: false,
  aimed: false,
  planning: false,
  carded: false,
};
const at = (over: Partial<PlanProgress>): PlanProgress => ({
  ...NOTHING,
  ...over,
});

describe("stageNow", () => {
  it("reads the act off what the host has actually done", () => {
    expect(stageNow(NOTHING)).toBe("area");
    expect(stageNow(at({ locked: true }))).toBe("draw");
    expect(stageNow(at({ locked: true, aimed: true }))).toBe("tune");
    expect(stageNow(at({ locked: true, aimed: true, planning: true }))).toBe(
      "enrich",
    );
    expect(stageNow(at({ carded: true }))).toBe("enrich");
  });

  it("counts a named patch as somewhere to aim, with no map at all", () => {
    // The typed-patch host never locks a frame and never draws — the brief is
    // the whole of their aim, and the rail has to follow them too.
    expect(stageNow(at({ aimed: true }))).toBe("tune");
  });
});

describe("stageDone", () => {
  it("ticks the acts behind and nothing else", () => {
    const here = at({ locked: true, aimed: true });
    expect(stageDone("area", here)).toBe(true);
    expect(stageDone("draw", here)).toBe(true);
    expect(stageDone("tune", here)).toBe(false);
    expect(stageDone("enrich", here)).toBe(false);
  });
});

describe("stageOpen", () => {
  it("opens the road behind and never the road ahead", () => {
    const here = at({ locked: true, aimed: true });
    expect(stageOpen("area", here)).toBe(true);
    expect(stageOpen("draw", here)).toBe(true);
    expect(stageOpen("tune", here)).toBe(true);
    // Enrich has not been asked for yet; a rail that offered it would open a
    // screen with nothing on it.
    expect(stageOpen("enrich", here)).toBe(false);
  });

  it("closes the way back out of a plan in flight", () => {
    const running = at({ locked: true, aimed: true, planning: true });
    for (const stage of ["area", "draw", "tune"] as PlanStage[]) {
      expect(stageOpen(stage, running)).toBe(false);
    }
    expect(stageOpen("enrich", running)).toBe(true);
  });

  it("opens it again the moment a card lands", () => {
    const landed = at({
      locked: true,
      aimed: true,
      planning: true,
      carded: true,
    });
    expect(stageOpen("draw", landed)).toBe(true);
    expect(stageOpen("tune", landed)).toBe(true);
  });

  it("always lets you stand where you already are", () => {
    for (const progress of [
      NOTHING,
      at({ locked: true }),
      at({ locked: true, aimed: true }),
      at({ planning: true }),
      at({ carded: true }),
    ]) {
      expect(stageOpen(stageNow(progress), progress)).toBe(true);
    }
  });
});

describe("undoFor", () => {
  it("keeps the frame when the host only wants to redraw", () => {
    expect(undoFor("draw")).toEqual({ release: false, clearStroke: true });
  });

  it("drops both only for the act that asks about the frame", () => {
    expect(undoFor("area")).toEqual({ release: true, clearStroke: true });
  });

  it("keeps the drawn line when stepping back to the brief", () => {
    expect(undoFor("tune")).toEqual({ release: false, clearStroke: false });
    expect(undoFor("enrich")).toEqual({ release: false, clearStroke: false });
  });

  it("answers for every act the rail can show", () => {
    for (const stage of PLAN_STAGES) {
      expect(undoFor(stage.id)).toBeDefined();
      expect(stage.label.length).toBeGreaterThan(0);
      expect(stage.doing.length).toBeGreaterThan(0);
    }
  });
});
