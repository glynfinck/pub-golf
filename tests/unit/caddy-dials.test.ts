import { describe, expect, it } from "vitest";

import {
  dialsReducer,
  DIALS_START,
  REROUTING,
  type DialAction,
  type DialState,
} from "@/lib/caddy/dials";

/**
 * Re-routing forgets the hand-edit and the open card — together, or not at all.
 *
 * This was six `reset()` calls in a hook, which is a convention rather than a
 * rule: each one had to remember three fields, and the versions that forgot
 * only two shipped. `tapped` left pointing at a position in a walk that no
 * longer existed is what made the swap card describe the wrong pub, made
 * "Swap" say "nothing else round here" over a full menu, and made "Later" on
 * the last stop look like an edit that never happened.
 *
 * A reducer makes the rule a function of the action, so it can be walked
 * exhaustively here instead of re-read carefully in review.
 */

const STOPS = ["a", "b", "c", "d"];

/** One of every action there is, with realistic arguments. The keys are the
 * action type union, so a new action without a row here fails to compile —
 * which is the point: it cannot skip the sweeps below by being forgotten. */
const ACTIONS: Record<DialAction["type"], DialAction> = {
  seed: { type: "seed", holes: 12, stretch: 7 },
  route: { type: "route", index: 3 },
  holes: { type: "holes", value: 6 },
  stretch: { type: "stretch", value: 8 },
  tap: { type: "tap", index: 1 },
  swapping: { type: "swapping", open: true },
  swap: { type: "swap", index: 1, id: "z", stops: STOPS },
  move: { type: "move", index: 1, delta: 1, stops: STOPS },
  restore: { type: "restore" },
};

const ALL = Object.values(ACTIONS);

/** A host mid-edit: a walk of their own, a card open on it, options showing. */
const HANDLED: DialState = {
  holes: 9,
  stretch: 5,
  routeIndex: 2,
  edited: ["a", "z", "c", "d"],
  tapped: 1,
  swapping: true,
};

describe("re-routing", () => {
  it("forgets the hand-edit, the open card and the swap list, every time", () => {
    const kept: string[] = [];
    for (const type of REROUTING) {
      const next = dialsReducer(HANDLED, ACTIONS[type]);
      if (next.edited !== null) kept.push(`${type}: edited`);
      if (next.tapped !== null) kept.push(`${type}: tapped`);
      if (next.swapping) kept.push(`${type}: swapping`);
    }
    expect(kept).toEqual([]);
  });

  it("puts the host back on the first walk when the walks are re-solved", () => {
    // Dialling holes or stretch re-solves the menu, so "the third one" is not
    // the same third one — leaving the index alone silently swapped the walk
    // under the host's finger.
    for (const type of ["holes", "stretch", "seed"] as const) {
      const next = dialsReducer(HANDLED, ACTIONS[type]);
      expect(`${type}: ${next.routeIndex}`).toBe(`${type}: 0`);
    }
    // Picking a walk is the one that keeps its index, because it *is* the index.
    expect(dialsReducer(HANDLED, ACTIONS.route).routeIndex).toBe(3);
  });

  it("changes the one dial it was asked to and no other", () => {
    const holes = dialsReducer(HANDLED, ACTIONS.holes);
    expect(holes.holes).toBe(6);
    expect(holes.stretch).toBe(HANDLED.stretch);

    const stretch = dialsReducer(HANDLED, ACTIONS.stretch);
    expect(stretch.stretch).toBe(8);
    expect(stretch.holes).toBe(HANDLED.holes);
  });

  it("takes both dials from a freshly delivered menu", () => {
    const next = dialsReducer(HANDLED, ACTIONS.seed);
    expect(next.holes).toBe(12);
    expect(next.stretch).toBe(7);
  });

  it("names every action that re-routes", () => {
    // The list is what the invariant is asserted over, so an action that
    // re-routes without being on it would go unguarded. Anything that changes
    // a dial or the chosen walk belongs here.
    const reroutes = ALL.filter((action) => {
      const next = dialsReducer(HANDLED, action);
      return (
        next.holes !== HANDLED.holes ||
        next.stretch !== HANDLED.stretch ||
        next.routeIndex !== HANDLED.routeIndex
      );
    }).map((action) => action.type);
    // `restore` re-routes by dropping the edit rather than by moving a dial,
    // so it is on the list without showing up in this sweep.
    expect(new Set(reroutes)).toEqual(
      new Set(REROUTING.filter((type) => type !== "restore")),
    );
    expect(REROUTING).toContain("restore");
  });
});

describe("the open card", () => {
  it("closes the last stop's swap list when another stop is tapped", () => {
    const next = dialsReducer(HANDLED, { type: "tap", index: 3 });
    expect(next.tapped).toBe(3);
    // One pub's name over another's options is the bug this prevents.
    expect(next.swapping).toBe(false);
  });

  it("closes on a tap of nothing", () => {
    expect(dialsReducer(HANDLED, { type: "tap", index: null }).tapped).toBeNull();
  });

  it("keeps the host's walk when they are only looking", () => {
    // Opening and closing cards is not editing, so it must not throw away an
    // edit — the reason `tap` is not on the re-routing list.
    for (const action of [
      ACTIONS.tap,
      ACTIONS.swapping,
      { type: "tap", index: null } as DialAction,
    ]) {
      expect(dialsReducer(HANDLED, action).edited).toEqual(HANDLED.edited);
      expect(dialsReducer(HANDLED, action).routeIndex).toBe(HANDLED.routeIndex);
    }
  });
});

describe("swapping a stop", () => {
  it("keeps the card on the stop that changed", () => {
    const next = dialsReducer(DIALS_START, ACTIONS.swap);
    expect(next.edited).toEqual(["a", "z", "c", "d"]);
    expect(next.tapped).toBe(1);
    // The list has served its purpose; leaving it open offers to swap the pub
    // that was just swapped in.
    expect(next.swapping).toBe(false);
  });

  it("edits the walk on screen, not the caddy's", () => {
    // `stops` comes in with the action precisely so a swap applies to the walk
    // the host is looking at — including one they have already edited.
    const next = dialsReducer(HANDLED, {
      type: "swap",
      index: 0,
      id: "y",
      stops: HANDLED.edited!,
    });
    expect(next.edited).toEqual(["y", "z", "c", "d"]);
  });
});

describe("moving a stop", () => {
  it("follows the stop the host moved", () => {
    const next = dialsReducer(DIALS_START, ACTIONS.move);
    expect(next.edited).toEqual(["a", "c", "b", "d"]);
    expect(next.tapped).toBe(2);
    expect(next.swapping).toBe(false);
  });

  it("moves earlier as well as later", () => {
    const next = dialsReducer(DIALS_START, {
      type: "move",
      index: 2,
      delta: -1,
      stops: STOPS,
    });
    expect(next.edited).toEqual(["a", "c", "b", "d"]);
    expect(next.tapped).toBe(1);
  });

  it("does nothing at all when the move is refused", () => {
    // "Later" on the last stop, "Earlier" on the first. Re-pointing the card
    // anyway opened a different pub's card and looked like an edit that never
    // happened — so a refused move returns the state itself, unchanged.
    for (const [index, delta] of [
      [STOPS.length - 1, 1],
      [0, -1],
    ]) {
      const next = dialsReducer(HANDLED, {
        type: "move",
        index,
        delta,
        stops: STOPS,
      });
      expect(next).toBe(HANDLED);
    }
  });

  it("never points the card past the end of the walk", () => {
    for (let index = 0; index < STOPS.length; index += 1) {
      for (const delta of [-1, 1]) {
        const next = dialsReducer(DIALS_START, {
          type: "move",
          index,
          delta,
          stops: STOPS,
        });
        if (next === DIALS_START) continue;
        expect(next.tapped).not.toBeNull();
        expect(next.tapped!).toBeGreaterThanOrEqual(0);
        expect(next.tapped!).toBeLessThan(next.edited!.length);
      }
    }
  });
});

describe("the reducer itself", () => {
  it("answers every action without throwing, from every state", () => {
    for (const state of [DIALS_START, HANDLED]) {
      for (const action of ALL) {
        expect(() => dialsReducer(state, action)).not.toThrow();
      }
    }
  });

  it("never mutates the state it was handed", () => {
    for (const action of ALL) {
      const before = structuredClone(HANDLED);
      dialsReducer(HANDLED, action);
      expect(HANDLED).toEqual(before);
    }
  });

  it("starts on a nine-hole walk with nothing edited", () => {
    expect(DIALS_START).toEqual({
      holes: 9,
      stretch: 5,
      routeIndex: 0,
      edited: null,
      tapped: null,
      swapping: false,
    });
  });
});
