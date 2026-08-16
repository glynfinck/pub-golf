import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PLAN_STAGES,
  STEP_COUNT,
  stageBack,
  stageHead,
  stageNow,
  stageOpen,
  type JobStage,
  type PlanProgress,
  type PlanStage,
} from "@/lib/caddy/stages";

/**
 * The top bar, which is one bar.
 *
 * Two complaints, one root. The bar "changed as you go through the process"
 * because it was two objects: the room's sat in flow on the page ground with
 * an instruction under it, and the gallery's floated over the map in a
 * bordered pill, off-centre, with a second headline pill and its own
 * hard-coded ticks — six differences between two things a host reads one after
 * the other. And it "looked weird" because four one-word chips never fitted a
 * 375px phone, which is what forced 10px type and a 44px lozenge around a
 * five-letter word.
 *
 * Both are answered by the same move: everything the bar says comes from
 * `stageHead`, so neither screen can hold an opinion of its own, and the four
 * acts become a track rather than four labels fighting for a row.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

const ORDER: PlanStage[] = PLAN_STAGES.map((stage) => stage.id);

/** The host's journey, act by act, as the room actually reports it. */
const AT: Record<PlanStage, PlanProgress> = {
  area: { locked: false, aimed: false, planning: false, carded: false },
  draw: { locked: true, aimed: false, planning: false, carded: false },
  tune: { locked: true, aimed: true, planning: false, carded: false },
  enrich: { locked: true, aimed: true, planning: true, carded: false },
};
const CARDED: PlanProgress = {
  locked: true,
  aimed: true,
  planning: false,
  carded: true,
};

const JOB_STAGES: JobStage[] = [
  "idle",
  "opening",
  "menu",
  "dressing",
  "done",
  "failed",
];

describe("the acts", () => {
  it("gives every one a title that is an instruction, not a label", () => {
    // "DRAW" in ten-pixel capitals was all four labels could afford. One act
    // at a time can say what to do, which is the entire reason for the change.
    for (const stage of PLAN_STAGES) {
      expect(`${stage.id}: ${stage.title.split(" ").length > 1}`).toBe(
        `${stage.id}: true`,
      );
      expect(stage.title).not.toBe(stage.label);
    }
  });

  it("counts against the list, never against a hard-coded four", () => {
    expect(STEP_COUNT).toBe(PLAN_STAGES.length);
    expect(stageHead(AT.area).note).toBe(`Step 1 of ${STEP_COUNT}`);
  });
});

describe("the head", () => {
  it("walks 1 to 4 as the host walks the acts", () => {
    const seen = ORDER.map((stage) => stageHead(AT[stage]));
    expect(seen.map((head) => head.filled)).toEqual([1, 2, 3, 4]);
    expect(seen.map((head) => head.note)).toEqual([
      "Step 1 of 4",
      "Step 2 of 4",
      "Step 3 of 4",
      "Step 4 of 4",
    ]);
  });

  it("inks the track to the act it is on, inclusive", () => {
    // Segment N is inked when you are on N, not when you have left it — a
    // track that only fills behind you reads as one act less than you have.
    for (const [index, stage] of ORDER.entries()) {
      expect(`${stage}: ${stageHead(AT[stage]).filled}`).toBe(
        `${stage}: ${index + 1}`,
      );
    }
  });

  it("titles the act until the caddy takes the ball, then lets it speak", () => {
    expect(stageHead(AT.draw).title).toBe("Draw the walk");
    expect(stageHead(AT.tune).title).toBe("Tune the brief");
    // A job that has never run must not put the caddy's voice on the bar.
    expect(stageHead(AT.area, "idle").title).toBe("Pick the area");
    expect(stageHead(AT.enrich, "dressing").title).toContain("dressing");
  });

  it("says a plan is on the wire, and only then", () => {
    expect(stageHead(AT.enrich, "dressing").working).toBe(true);
    expect(stageHead(AT.enrich, "opening").note).toBe("Step 4 of 4 · working");
    for (const job of ["idle", "menu", "done", "failed"] as JobStage[]) {
      expect(`${job}: ${stageHead(AT.enrich, job).working}`).toBe(
        `${job}: false`,
      );
    }
  });

  it("stops counting steps once there are none left", () => {
    // "Step 4 of 4" over a finished card is a progress bar still asking to be
    // finished. The count earns its row back by becoming the card's size.
    expect(stageHead(CARDED, "done", 9).note).toBe("9 holes · on the table");
    expect(stageHead(CARDED, "done").note).toBe("On the table");
    expect(stageHead(CARDED, "done", 9).carded).toBe(true);
    expect(stageHead(CARDED, "done", 9).filled).toBe(STEP_COUNT);
  });

  it("always has something in both rows, at every stage and every job", () => {
    const blank: string[] = [];
    for (const stage of ORDER) {
      for (const job of JOB_STAGES) {
        const head = stageHead(AT[stage], job, null);
        if (!head.title.trim()) blank.push(`${stage}/${job}: title`);
        if (!head.note.trim()) blank.push(`${stage}/${job}: note`);
        if (head.filled < 1 || head.filled > STEP_COUNT) {
          blank.push(`${stage}/${job}: filled=${head.filled}`);
        }
      }
    }
    expect(blank).toEqual([]);
  });

  it("reads the same from either screen", () => {
    // The persistence rule, as arithmetic: one progress in, one head out. The
    // gallery cannot hold a second opinion because it no longer has one.
    const room = stageHead(AT.enrich, "dressing", null);
    const gallery = stageHead(AT.enrich, "dressing", null);
    expect(gallery).toEqual(room);
  });
});

describe("back", () => {
  it("lands on the act immediately behind", () => {
    expect(stageBack(AT.draw)).toBe("area");
    expect(stageBack(AT.tune)).toBe("draw");
  });

  it("has nowhere to go from the first act", () => {
    // Where the room's arrow means "leave" instead.
    expect(stageBack(AT.area)).toBeNull();
  });

  it("has nowhere to go while a plan is on the wire", () => {
    // The fee is spent and a half-cancelled plan is the state this codebase
    // has worked hardest never to have. The arrow greys; it does not vanish.
    expect(stageBack(AT.enrich)).toBeNull();
  });

  it("opens again the moment a card lands", () => {
    expect(stageBack(CARDED)).toBe("tune");
  });

  it("only ever lands somewhere the rules say is open", () => {
    for (const progress of [...ORDER.map((s) => AT[s]), CARDED]) {
      const back = stageBack(progress);
      if (!back) continue;
      expect(stageOpen(back, progress)).toBe(true);
      // And strictly behind — back that goes forward is not back.
      expect(ORDER.indexOf(back)).toBeLessThan(
        ORDER.indexOf(stageNow(progress)),
      );
    }
  });
});

describe("one bar, two screens", () => {
  const BAR = read("components/course/stage-bar.tsx");
  const ROOM = read("components/course/course-room.tsx");
  const GALLERY = read("components/course/caddy-gallery.tsx");

  it("is the same component on both", () => {
    for (const [name, source] of [
      ["room", ROOM],
      ["gallery", GALLERY],
    ] as const) {
      expect(`${name}: ${source.includes("<StageBar")}`).toBe(`${name}: true`);
    }
  });

  it("leaves the chip rail deleted", () => {
    // The four-label row, by every name it went under.
    for (const source of [ROOM, GALLERY]) {
      expect(source).not.toContain("StageRail");
      expect(source).not.toContain("stage-rail");
    }
  });

  it("lets neither screen invent its own ticks", () => {
    // The gallery hard-coded `locked: true, aimed: true` and applied it to the
    // Course Room too, where all four acts are real — so the same moment
    // ticked differently on the two screens showing it.
    expect(GALLERY).not.toMatch(/galleryProgress/);
    expect(GALLERY).toMatch(/progress: PlanProgress/);
  });

  it("keeps the floating pill and its headline twin gone", () => {
    // The bar is in flow on both, which is what stops it moving between them.
    expect(GALLERY).not.toContain("right-14");
    expect(GALLERY).not.toContain("JOB_HEADLINE");
  });

  it("reserves both flanks so the title sits on the page's centre", () => {
    // 44 | flexible | 44, whatever either slot holds. The room's right slot is
    // empty and the gallery's holds the close button; an unreserved slot is
    // what put the old rail half a button right of centre.
    expect(BAR).toContain("size-11 shrink-0");
    expect(BAR).toMatch(/max-w-md/);
  });

  it("disables the arrow rather than removing it", () => {
    // A control that vanishes moves everything beside it — which is the
    // complaint this whole change answers, in miniature.
    expect(BAR).toContain("disabled={!onBack}");
  });
});
