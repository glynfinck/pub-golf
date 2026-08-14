import { describe, expect, it } from "vitest";

import type { MenuNode } from "@/lib/caddy/menu";
import { swapOptions, walkKm, withMove, withSwap } from "@/lib/caddy/swap";

/**
 * "Not that pub" — the commonest note a host has, and until now the only two
 * answers were re-roll the whole card or edit it by hand afterwards.
 *
 * Every one of these runs in the browser over the lean nodes, which is what
 * makes turning a walk over free. If any of it ever needs the server, that is
 * the covenant breaking rather than an optimisation being missed.
 */

const STEP = 0.006;

function node(id: string, col: number, row = 0, rating = 4): MenuNode {
  return {
    id,
    name: `The ${id}`,
    lat: 51.5 + row * STEP,
    lng: -0.1 + col * STEP,
    rating,
    address: `${col} Example Street`,
    reviewCount: 100,
  };
}

/** A row of six along a street, plus three sitting off it. */
const NODES: MenuNode[] = [
  node("a", 0),
  node("b", 1),
  node("c", 2),
  node("d", 3),
  node("e", 4),
  node("f", 5),
  node("c2", 2, 1, 4.8),
  node("c3", 2, -1, 3.2),
  node("far", 12, 6),
];

const WALK = ["a", "b", "c", "d"];

describe("swapOptions", () => {
  it("offers what stands near the stop being replaced, nearest first", () => {
    const options = swapOptions(WALK, 2, NODES);
    expect(options.length).toBeGreaterThan(0);
    // c2 and c3 sit directly off c, so they lead.
    expect(
      options
        .slice(0, 2)
        .map((option) => option.id)
        .sort(),
    ).toEqual(["c2", "c3"]);
    for (let i = 1; i < options.length; i += 1) {
      expect(options[i].awayKm).toBeGreaterThanOrEqual(options[i - 1].awayKm);
    }
  });

  it("never offers a pub already on the walk", () => {
    const ids = swapOptions(WALK, 2, NODES).map((option) => option.id);
    for (const stop of WALK) expect(ids).not.toContain(stop);
  });

  it("says what a swap does to the whole walk", () => {
    const options = swapOptions(WALK, 2, NODES);
    for (const option of options) {
      const after = walkKm(withSwap(WALK, 2, option.id), NODES);
      expect(after - walkKm(WALK, NODES)).toBeCloseTo(option.deltaKm, 9);
    }
  });

  it("charges a detour to the walk rather than hiding it", () => {
    const far = swapOptions(WALK, 2, NODES, 99).find(
      (option) => option.id === "far",
    );
    expect(far).toBeDefined();
    expect(far!.deltaKm).toBeGreaterThan(1);
  });

  it("measures the ends against one leg, not two", () => {
    // The first stop has nothing before it, so replacing it can only change
    // the leg out of it — a swap at an end must not be charged for a leg that
    // does not exist.
    const first = swapOptions(WALK, 0, NODES, 99);
    for (const option of first) {
      const after = walkKm(withSwap(WALK, 0, option.id), NODES);
      expect(after - walkKm(WALK, NODES)).toBeCloseTo(option.deltaKm, 9);
    }
  });

  it("degrades rather than throwing", () => {
    expect(swapOptions(WALK, 9, NODES)).toEqual([]);
    expect(swapOptions(WALK, -1, NODES)).toEqual([]);
    expect(swapOptions(["ghost"], 0, NODES)).toEqual([]);
    expect(swapOptions(WALK, 2, NODES, 0)).toEqual([]);
  });

  it("is stable — the same walk gives the same list", () => {
    expect(swapOptions(WALK, 2, NODES)).toEqual(swapOptions(WALK, 2, NODES));
    expect(swapOptions(WALK, 2, [...NODES].reverse())).toEqual(
      swapOptions(WALK, 2, NODES),
    );
  });
});

describe("withSwap", () => {
  it("puts the new pub in the old one's place and leaves the rest", () => {
    expect(withSwap(WALK, 2, "c2")).toEqual(["a", "b", "c2", "d"]);
  });

  it("refuses to put the same door on the card twice", () => {
    expect(withSwap(WALK, 2, "a")).toEqual(WALK);
  });

  it("ignores an index it does not have", () => {
    expect(withSwap(WALK, 12, "c2")).toEqual(WALK);
    expect(withSwap(WALK, -1, "c2")).toEqual(WALK);
  });
});

describe("withMove", () => {
  it("moves a stop earlier and later without changing who is on the card", () => {
    expect(withMove(WALK, 2, -1)).toEqual(["a", "c", "b", "d"]);
    expect(withMove(WALK, 1, 1)).toEqual(["a", "c", "b", "d"]);
    expect([...withMove(WALK, 2, -1)].sort()).toEqual([...WALK].sort());
  });

  it("stops at the ends of the walk", () => {
    expect(withMove(WALK, 0, -1)).toEqual(WALK);
    expect(withMove(WALK, WALK.length - 1, 1)).toEqual(WALK);
  });

  it("keeps the walk's membership exactly", () => {
    const moved = withMove(WALK, 1, 1);
    expect(new Set(moved)).toEqual(new Set(WALK));
    expect(moved).toHaveLength(WALK.length);
  });
});
