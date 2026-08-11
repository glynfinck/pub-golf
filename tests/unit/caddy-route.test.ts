import { describe, expect, it } from "vitest";

import { orderWalk, walkKm, type WalkStop } from "@/lib/caddy/route";

/**
 * A tidy grid so the right answer is obvious by eye. Roughly 111m per 0.001
 * degree of latitude, so these are a few hundred metres apart — pub distances.
 */
function at(x: number, y: number): WalkStop & { id: string } {
  return { id: `${x},${y}`, lat: 51.5 + y * 0.003, lng: -0.08 + x * 0.003 };
}

const ids = (stops: { id: string }[]) => stops.map((s) => s.id);

describe("orderWalk", () => {
  it("turns a scatter into a line", () => {
    // Five pubs along a street, handed over shuffled — the exact failure the
    // first real generated card had.
    const line = [at(0, 0), at(1, 0), at(2, 0), at(3, 0), at(4, 0)];
    const shuffled = [line[3], line[0], line[4], line[1], line[2]];
    const walked = orderWalk(shuffled);
    expect(walkKm(walked)).toBeLessThan(walkKm(shuffled));
    // Along the street, one way — either direction is equally correct.
    expect([ids(line), [...ids(line)].reverse()]).toContainEqual(ids(walked));
  });

  it("removes crossings, which is what 'a continuous shape' means", () => {
    // A square taken in a bow-tie order: 0,0 → 1,1 → 1,0 → 0,1 crosses itself.
    const bowtie = [at(0, 0), at(1, 1), at(1, 0), at(0, 1)];
    const walked = orderWalk(bowtie);
    expect(walkKm(walked)).toBeLessThan(walkKm(bowtie));
  });

  it("never returns a longer walk than it was given", () => {
    // The guarantee that makes turning this on safe: it can only help.
    const cases: WalkStop[][] = [
      [at(0, 0), at(1, 0), at(2, 0)],
      [at(0, 0), at(3, 3), at(1, 1), at(2, 2)],
      [at(2, 0), at(0, 1), at(1, 3), at(3, 2), at(0, 0), at(3, 0)],
    ];
    cases.forEach((stops) => {
      expect(walkKm(orderWalk(stops))).toBeLessThanOrEqual(walkKm(stops) + 1e-9);
    });
  });

  it("honours a pinned first tee wherever the caddy left it", () => {
    // The pin used to be checked and the card thrown away if it was wrong.
    // Now it is enforced, which is the better answer: the pub is on the card,
    // and which end it belongs at is something we can fix for free.
    const stops = [at(0, 0), at(1, 0), at(2, 0), at(3, 0)];
    const scrambled = [stops[1], stops[3], stops[0], stops[2]];
    const walked = orderWalk(scrambled, { first: 1 });
    expect(walked[0]).toBe(stops[3]);
  });

  it("honours both pins at once", () => {
    const stops = [at(0, 0), at(1, 0), at(2, 0), at(3, 0), at(4, 0)];
    const scrambled = [stops[2], stops[0], stops[4], stops[1], stops[3]];
    const walked = orderWalk(scrambled, { first: 0, last: 1 });
    expect(walked[0]).toBe(stops[2]);
    expect(walked[walked.length - 1]).toBe(stops[0]);
  });

  it("leaves a pub with no coordinates exactly where it was", () => {
    // It cannot be measured, so moving it would be guessing — and the caddy's
    // own placement is a better guess than ours.
    const nameOnly = { id: "by-hand", lat: null, lng: null };
    const stops = [at(3, 0), nameOnly, at(0, 0), at(1, 0), at(2, 0)];
    const walked = orderWalk(stops);
    expect(walked[1]).toBe(nameOnly);
    expect(walked).toHaveLength(5);
  });

  it("does nothing to a walk too short to reorder", () => {
    expect(orderWalk([])).toEqual([]);
    const two = [at(1, 1), at(0, 0)];
    expect(orderWalk(two)).toEqual(two);
  });

  it("keeps every stop, exactly once", () => {
    const stops = [at(0, 0), at(2, 3), at(1, 1), at(3, 0), at(0, 2), at(2, 1)];
    const walked = orderWalk(stops);
    expect(walked).toHaveLength(stops.length);
    expect(new Set(walked).size).toBe(stops.length);
    stops.forEach((stop) => expect(walked).toContain(stop));
  });

  it("is deterministic — the same pubs give the same walk", () => {
    const stops = [at(0, 0), at(2, 3), at(1, 1), at(3, 0), at(0, 2)];
    expect(ids(orderWalk(stops))).toEqual(ids(orderWalk(stops)));
  });
});

describe("shapes", () => {
  const square = [at(0, 0), at(2, 2), at(2, 0), at(0, 2)];

  it("a loop counts the walk home, so it goes round rather than across", () => {
    const walked = orderWalk(square, { shape: "loop", first: 0 });
    expect(walked[0]).toBe(square[0]);

    // Note these four corners are not a square on the ground. At 51.5°N a
    // degree of longitude is about 62% of a degree of latitude, so the
    // east–west sides are shorter — and the northern one is shorter again than
    // the southern, since longitude keeps shrinking as you go up. So the
    // perimeter is walked corner to corner rather than assumed from one side;
    // doubling a side is out by centimetres, which is enough to fail a close
    // comparison and tells you nothing about the route.
    const perimeter = walkKm([at(0, 0), at(2, 0), at(2, 2), at(0, 2), at(0, 0)]);

    const closed = walkKm(walked) + walkKm([walked[walked.length - 1], walked[0]]);
    expect(closed).toBeCloseTo(perimeter, 5);

    // And no leg is a diagonal, which is what going "across" would look like.
    const diagonal = walkKm([at(0, 0), at(2, 2)]);
    walked.forEach((_, i) => {
      if (i === 0) return;
      expect(walkKm([walked[i - 1], walked[i]])).toBeLessThan(diagonal - 1e-9);
    });
  });

  it("a loop is never shorter than the best path over the same pubs", () => {
    // The trade the host is making, stated as a test: you pay for the walk home.
    const path = orderWalk(square, { shape: "path" });
    const loop = orderWalk(square, { shape: "loop" });
    const loopTotal = walkKm(loop) + walkKm([loop[loop.length - 1], loop[0]]);
    expect(loopTotal).toBeGreaterThanOrEqual(walkKm(path) - 1e-9);
  });

  it("ignores a pinned finish on a loop, because the loop decides it", () => {
    const walked = orderWalk(square, { shape: "loop", first: 0, last: 1 });
    expect(walked[0]).toBe(square[0]);
    expect(walked).toHaveLength(4);
  });
});

describe("at eighteen holes", () => {
  it("stays fast and still improves the walk", () => {
    // The largest round the house offers, in a deliberately awful order.
    const stops = Array.from({ length: 18 }, (_, i) =>
      at((i * 7) % 5, (i * 11) % 5),
    );
    const started = Date.now();
    const walked = orderWalk(stops);
    expect(Date.now() - started).toBeLessThan(500);
    expect(walkKm(walked)).toBeLessThanOrEqual(walkKm(stops) + 1e-9);
    expect(walked).toHaveLength(18);
  });
});
