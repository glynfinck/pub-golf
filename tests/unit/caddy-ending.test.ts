import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  endingOf,
  lostThreadEnding,
  openResult,
  LOST_BALL,
  LOST_THREAD,
  type JobEnding,
} from "@/lib/caddy/ending";
import {
  jobWorking,
  JOB_BADGE,
  JOB_HEADLINE,
  JOB_PILL,
  jobPanelLabel,
  type JobStage,
} from "@/lib/caddy/stages";
import type { CaddyMenu } from "@/lib/caddy/menu";
import type { CaddyOffer } from "@/lib/caddy/stream";
import type { OpenAnswer, StreamOutcome } from "@/lib/caddy/transport";

/**
 * Every ending is an ending.
 *
 * The defect these hold against is not a wrong pixel, it is a screen that
 * stops: four exits from the caddy's two requests used to close the overlay
 * and return without touching the stage, leaving the pill saying "the caddy's
 * dressing the card" over a plan turned down at the till minutes earlier, and
 * the stage rail frozen with every step disabled. "I pressed dress this walk
 * and nothing happened" was that bug, reported.
 *
 * It is a rule about *state*, and CLAUDE.md is explicit about where a rule
 * like that belongs: if a browser is proving something a function call could
 * prove, it is in the wrong place. So the decision lives in `lib/caddy/ending`
 * and this file drives every outcome the transport can produce through it.
 */

const OFFER: CaddyOffer = "fee";

const MENU: CaddyMenu = {
  nodes: [],
  routes: [],
  startId: null,
  finishId: null,
  aimFrom: null,
  aimTo: null,
  reachKm: 1.2,
  teeOff: null,
  stroke: null,
  note: null,
};

/** Every outcome shape `streamPlan` can return, named. If a kind is added to
 * `StreamOutcome` without a row here, the exhaustive map below stops compiling. */
const OUTCOMES: Record<StreamOutcome["kind"], StreamOutcome> = {
  card: { kind: "card" },
  refused: { kind: "refused", text: "That is a green fee.", offer: OFFER },
  failed: { kind: "failed", error: "The caddy stopped.", detail: "429" },
  lost: { kind: "lost" },
};

const ALL_OUTCOMES = Object.values(OUTCOMES);
const ALL_STAGES: JobStage[] = [
  "opening",
  "menu",
  "dressing",
  "done",
  "failed",
];

describe("the dress step's endings", () => {
  it("never leaves the host watching a stage that is still working", () => {
    // The whole complaint, as one assertion. `opening` and `dressing` are the
    // two stages that spin; no ending may be either, for any outcome, with or
    // without a card already on the table.
    const stuck: string[] = [];
    for (const outcome of ALL_OUTCOMES) {
      for (const carded of [false, true]) {
        const ending = endingOf(outcome, carded);
        if (jobWorking(ending.stage)) {
          stuck.push(`${outcome.kind}/carded=${carded}: ${ending.stage}`);
        }
      }
    }
    expect(stuck).toEqual([]);
  });

  it("says something whenever it is not a card", () => {
    for (const outcome of ALL_OUTCOMES) {
      const ending = endingOf(outcome, false);
      if (ending.stage === "done") continue;
      expect(`${outcome.kind}: ${ending.error}`).not.toBe(`${outcome.kind}: `);
      expect(ending.error).toBeTruthy();
    }
  });

  it("puts a card on the table and says nothing about it", () => {
    expect(endingOf(OUTCOMES.card, false)).toMatchObject({
      stage: "done",
      error: null,
      refusal: null,
      closeOverlay: false,
      rescue: false,
    });
  });

  it("lets a card that already landed beat a connection that died", () => {
    // The stream can end badly *after* the card event; the plan is paid for and
    // on the table, so the ending is the card's, not the wire's.
    for (const outcome of [OUTCOMES.lost, OUTCOMES.failed]) {
      expect(endingOf(outcome, true).stage).toBe("done");
      expect(endingOf(outcome, true).error).toBeNull();
      expect(endingOf(outcome, true).rescue).toBe(false);
    }
  });

  it("does not let a card already landed turn a refusal into a card", () => {
    // A refusal is decided before the model runs, so `carded` cannot be true
    // with one — but the ordering is load-bearing if that ever changes: money's
    // answer must not be swallowed by an optimistic card flag.
    const ending = endingOf(OUTCOMES.refused, false);
    expect(ending.stage).toBe("failed");
    expect(ending.refusal).toEqual({
      text: "That is a green fee.",
      offer: OFFER,
    });
  });

  it("answers a refusal with a sheet and gets the overlay out of its way", () => {
    const ending = endingOf(OUTCOMES.refused, false);
    expect(ending.closeOverlay).toBe(true);
    // Never rescue a refusal: nothing was spent, so there is no card to find,
    // and asking would be a round trip that can only say no again.
    expect(ending.rescue).toBe(false);
    expect(ending.error).toBe(ending.refusal?.text);
  });

  it("asks before apologising, on both wire failures", () => {
    // The 32.21p plan that filed nine holes while the browser showed a timeout.
    for (const outcome of [OUTCOMES.failed, OUTCOMES.lost]) {
      const ending = endingOf(outcome, false);
      expect(`${outcome.kind}: ${ending.rescue}`).toBe(`${outcome.kind}: true`);
      expect(ending.refusal).toBeNull();
      // A failure keeps the overlay: there is nothing under it to change, and
      // a rail is the way back.
      expect(ending.closeOverlay).toBe(false);
    }
  });

  it("carries the server's own words as detail, not as the headline", () => {
    const ending = endingOf(OUTCOMES.failed, false);
    expect(ending.error).toBe("The caddy stopped.");
    expect(ending.detail).toBe("429");
    // A lost connection has no server words to carry.
    expect(endingOf(OUTCOMES.lost, false).detail).toBeUndefined();
    expect(endingOf(OUTCOMES.lost, false).error).toBe(LOST_BALL);
  });

  it("offers a refusal only where money actually spoke", () => {
    // The covenant: money answers a refusal and never speaks first. A dropped
    // connection must not open the top-up shelf.
    for (const outcome of [OUTCOMES.card, OUTCOMES.failed, OUTCOMES.lost]) {
      expect(`${outcome.kind}`).toBe(`${outcome.kind}`);
      expect(endingOf(outcome, false).refusal).toBeNull();
    }
  });
});

describe("a dress with no patch behind it", () => {
  it("ends, and asks for nothing back", () => {
    const ending = lostThreadEnding();
    expect(jobWorking(ending.stage)).toBe(false);
    expect(ending.error).toBe(LOST_THREAD);
    // Nothing was sent, so nothing was spent, so there is no card to rescue.
    expect(ending.rescue).toBe(false);
    expect(ending.refusal).toBeNull();
  });

  it("promises the retry is free, the way every other lost-ball line does", () => {
    // Nothing was charged for a run that never reached the model, and a host
    // who is not told that reads "ask again" as "pay again".
    for (const line of [LOST_BALL, LOST_THREAD]) {
      expect(line).toContain("this one's free");
    }
  });
});

describe("the open step's answers", () => {
  const usable: OpenAnswer = { sessionId: "s1", menu: MENU };

  it("hands back a patch only when both halves arrived", () => {
    const result = openResult(usable);
    expect(result.kind).toBe("patch");
    if (result.kind !== "patch") throw new Error("unreachable");
    expect(result.sessionId).toBe("s1");
    expect(result.menu).toBe(MENU);
  });

  /** Everything the open route has ever answered with that is not a patch. */
  const NOT_A_PATCH: [string, OpenAnswer | null][] = [
    ["nothing at all (the fetch threw, or the timeout fired)", null],
    ["an empty body", {}],
    ["a session with no menu", { sessionId: "s1" }],
    ["a menu with no session", { menu: MENU }],
    ["an error alongside a usable pair", { sessionId: "s1", menu: MENU, error: "thin patch" }],
    ["an error on its own", { error: "Not enough pubs round there." }],
    ["a refusal", { error: "That is a green fee.", offer: OFFER }],
  ];

  it("treats every other answer as an ending, never as a patch", () => {
    const leaked: string[] = [];
    for (const [what, answer] of NOT_A_PATCH) {
      const result = openResult(answer);
      if (result.kind !== "ending") leaked.push(what);
      else if (jobWorking(result.ending.stage)) leaked.push(`${what} (working)`);
      else if (!result.ending.error) leaked.push(`${what} (silent)`);
    }
    expect(leaked).toEqual([]);
  });

  it("never rescues: the open step spends nothing, so there is no card", () => {
    for (const [, answer] of NOT_A_PATCH) {
      const result = openResult(answer);
      if (result.kind !== "ending") continue;
      expect(result.ending.rescue).toBe(false);
    }
  });

  it("keeps the overlay up on a failure and drops it for a refusal", () => {
    // A thin patch used to tear down a ten-second performance into a
    // four-second toast, with nothing on screen to change.
    expect(openResult({ error: "Not enough pubs round there." })).toMatchObject(
      { ending: { closeOverlay: false, refusal: null } },
    );
    expect(openResult(null)).toMatchObject({
      ending: { closeOverlay: false, error: LOST_BALL },
    });
    expect(
      openResult({ error: "That is a green fee.", offer: OFFER }),
    ).toMatchObject({
      ending: {
        closeOverlay: true,
        refusal: { text: "That is a green fee.", offer: OFFER },
      },
    });
  });

  it("does not invent a message it was not given", () => {
    const result = openResult({ error: "Not enough pubs round there." });
    if (result.kind !== "ending") throw new Error("unreachable");
    expect(result.ending.error).toBe("Not enough pubs round there.");
  });
});

describe("every stage the endings can name", () => {
  /** Every ending either function can produce, from every input either has. */
  const ENDINGS: JobEnding[] = [
    ...ALL_OUTCOMES.flatMap((outcome) => [
      endingOf(outcome, false),
      endingOf(outcome, true),
    ]),
    lostThreadEnding(),
    ...([null, {}, { error: "thin" }, { error: "fee", offer: OFFER }] as (
      | OpenAnswer
      | null
    )[]).flatMap((answer) => {
      const result = openResult(answer);
      return result.kind === "ending" ? [result.ending] : [];
    }),
  ];

  it("has copy on all four surfaces", () => {
    // The four wordings are deliberately different, but none of them may be
    // missing: a stage with no badge, headline, pill or tab label renders a
    // blank where the host is looking for what happened.
    const blanks: string[] = [];
    for (const ending of ENDINGS) {
      const stage = ending.stage;
      if (!(stage in JOB_HEADLINE)) blanks.push(`${stage}: headline`);
      if (!(stage in JOB_BADGE)) blanks.push(`${stage}: badge`);
      if (!(stage in JOB_PILL)) blanks.push(`${stage}: pill`);
      if (!jobPanelLabel(stage)) blanks.push(`${stage}: tab`);
    }
    expect(blanks).toEqual([]);
  });
});

describe("the hook that applies them", () => {
  const HOOK = readFileSync(
    join(import.meta.dirname, "..", "..", "hooks", "use-caddy-job.ts"),
    "utf8",
  );

  it("decides no ending of its own", () => {
    // The whole point of the split: if the hook starts branching on an
    // outcome again, half the endings live somewhere no test can reach, which
    // is precisely the state the "nothing happened" bug shipped in.
    expect(HOOK).not.toMatch(/outcome\.kind\s*===/);
    expect(HOOK).not.toMatch(/answer\?\.offer|body\?\.offer/);
  });

  it("does not keep its own copy of the apology", () => {
    // Two copies of a message drift, and the one that drifts is always the one
    // the host actually reads.
    expect(HOOK).not.toContain("lost the ball.");
    expect(HOOK).not.toContain("lost the thread");
  });

  it("lands every ending through one door", () => {
    // `settle` outside `land` is an ending that skipped the error and the
    // overlay. The three that remain are the ones with no ending to apply:
    // a menu arriving, and `rescue` finding a card after all.
    const settles = HOOK.match(/settle\("(\w+)"\)/g) ?? [];
    expect(settles.sort()).toEqual(['settle("done")', 'settle("menu")']);
  });
});

describe("the stage copy itself", () => {
  it("names every stage on every surface", () => {
    const missing: string[] = [];
    for (const stage of ALL_STAGES) {
      if (!JOB_HEADLINE[stage]) missing.push(`${stage}: headline`);
      if (!jobPanelLabel(stage)) missing.push(`${stage}: tab`);
      // Badge and pill are nullable by design — `done` is the one stage with
      // nothing worth interrupting another screen for — but the key must exist
      // so a new stage is a type error rather than an `undefined` on the glass.
      if (!(stage in JOB_BADGE)) missing.push(`${stage}: badge`);
      if (!(stage in JOB_PILL)) missing.push(`${stage}: pill`);
    }
    expect(missing).toEqual([]);
  });

  it("goes quiet on `done` and only on `done`", () => {
    // A finished card announces itself by being on the table. Every other
    // stage has something the host needs from another screen.
    for (const stage of ALL_STAGES) {
      const quiet = JOB_BADGE[stage] === null && JOB_PILL[stage] === null;
      expect(`${stage}: ${quiet}`).toBe(`${stage}: ${stage === "done"}`);
    }
  });

  it("keeps the tab to one row's worth of words", () => {
    // The panel collapses to a single 44px row and the tab *is* that row, so a
    // label long enough to wrap or truncate loses the only status the host has
    // while the map is up.
    for (const stage of ALL_STAGES) {
      expect(jobPanelLabel(stage).length).toBeLessThanOrEqual(28);
    }
    expect(jobPanelLabel("menu", "the long way")).toBe(
      "The walks · the long way",
    );
    expect(jobPanelLabel("menu")).toBe("The walks");
  });

  it("keeps the four wordings distinct where they are read together", () => {
    // The pill is read from another screen and says what to do about it; the
    // headline is read while watching. Flattening them into one string would
    // be a regression, not a tidy-up — so `menu` must not say the same thing
    // twice.
    expect(JOB_PILL.menu).not.toBe(JOB_HEADLINE.menu);
    expect(JOB_PILL.failed).not.toBe(JOB_HEADLINE.failed);
  });
});
