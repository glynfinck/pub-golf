import { describe, expect, it } from "vitest";

import {
  forwardOrder,
  orderWalk,
  tryRoute,
  type WalkStop,
  walkKm,
} from "@/lib/caddy/route";
import { WALK_MINUTES_PER_KM } from "@/lib/geo";

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

describe("minimum leg", () => {
  /** Minutes between two consecutive stops, the way the app measures it. */
  const legMinutes = (a: WalkStop, b: WalkStop) =>
    walkKm([a, b]) * WALK_MINUTES_PER_KM;

  /** How many times a short leg immediately follows another — "three pubs in
   * a row", which is the shape actually complained about. */
  function runsOfShort(stops: WalkStop[], min: number) {
    let runs = 0;
    let previousShort = false;
    for (let i = 1; i < stops.length; i++) {
      const short = legMinutes(stops[i - 1], stops[i]) < min;
      if (short && previousShort) runs++;
      previousShort = short;
    }
    return runs;
  }

  /** Three pubs on one corner, plus four spread out — the real case. */
  const clustered = [
    at(0, 0),
    at(0.05, 0),
    at(0.1, 0),
    at(4, 0),
    at(8, 0),
    at(12, 0),
    at(16, 0),
  ];

  it("stacks the close ones together when spacing is off", () => {
    // Shortest total distance is exactly what produces the bad card, and this
    // asserts that — the objective was wrong, not the algorithm.
    const walked = orderWalk(clustered, { minLegMinutes: 0 });
    expect(runsOfShort(walked, 5)).toBeGreaterThan(0);
  });

  it("breaks up three-in-a-row once a minimum is asked for", () => {
    const walked = orderWalk(clustered, { minLegMinutes: 5 });
    expect(runsOfShort(walked, 5)).toBe(0);
  });

  it("buys that spacing with distance, which is the trade being made", () => {
    const tight = orderWalk(clustered, { minLegMinutes: 0 });
    const spread = orderWalk(clustered, { minLegMinutes: 5 });
    expect(walkKm(spread)).toBeGreaterThan(walkKm(tight));
  });

  it("spreads harder when asked for a longer stretch", () => {
    const steady = orderWalk(clustered, { minLegMinutes: 5 });
    const stretch = orderWalk(clustered, { minLegMinutes: 10 });
    expect(walkKm(stretch)).toBeGreaterThanOrEqual(walkKm(steady) - 1e-9);
  });

  it("still honours pins while spacing", () => {
    const walked = orderWalk(clustered, { minLegMinutes: 5, first: 6, last: 0 });
    expect(walked[0]).toBe(clustered[6]);
    expect(walked[walked.length - 1]).toBe(clustered[0]);
  });

  it("keeps every pub — spacing reorders, it never drops", () => {
    const walked = orderWalk(clustered, { minLegMinutes: 10 });
    expect(new Set(walked).size).toBe(clustered.length);
  });

  it("does the best it can in a patch that cannot answer", () => {
    // Every pub on one street corner: no ordering satisfies the minimum, and
    // the right behaviour is a card anyway rather than a refusal.
    const dense = [at(0, 0), at(0.05, 0), at(0.1, 0), at(0.15, 0)];
    const walked = orderWalk(dense, { minLegMinutes: 10 });
    expect(walked).toHaveLength(4);
    expect(new Set(walked).size).toBe(4);
  });
});

describe("tryRoute — what the caddy gets to see before it commits", () => {
  /** A grid of pubs, roughly 220m per step east and 330m per step north. */
  const pub = (id: string, x: number, y: number) => ({
    id,
    lat: 51.5 + y * 0.003,
    lng: -0.08 + x * 0.003,
  });

  it("reports the walking order, which is not the order it was handed", () => {
    // The whole reason this tool exists: the caddy proposes a set, and the
    // club's own router decides the sequence. Before this it found that out
    // after answering, which is to say never.
    const trial = tryRoute([pub("p1", 0, 0), pub("p2", 8, 0), pub("p3", 1, 0)]);
    expect(trial.order).toHaveLength(3);
    expect(new Set(trial.order)).toEqual(new Set(["p1", "p2", "p3"]));
    expect(trial.order).not.toEqual(["p1", "p2", "p3"]);
  });

  it("measures in the units the brief is written in", () => {
    // The host sets a minimum walk in minutes, so the answer comes back in
    // minutes. A caddy asked to fix "0.42 km" against a five-minute rule is
    // being asked to do arithmetic instead of judgment.
    const trial = tryRoute([pub("p1", 0, 0), pub("p2", 10, 0)]);
    expect(trial.legs).toHaveLength(1);
    expect(trial.legs[0].minutes).toBeGreaterThan(0);
    expect(trial.totalMinutes).toBe(trial.legs[0].minutes);
  });

  it("names three pubs on one corner as a run, not as three separate niggles", () => {
    // The complaint that started the spacing work — "it did 3 pubs all right
    // next to each other". One short leg is a shortcut; two in a row is a
    // huddle, and only `worstRun` can tell them apart.
    const huddle = tryRoute(
      [pub("p1", 0, 0), pub("p2", 0.2, 0), pub("p3", 0.4, 0), pub("p4", 20, 0)],
      { minLegMinutes: 5 },
    );
    expect(huddle.shortLegs).toBeGreaterThanOrEqual(2);
    expect(huddle.worstRun).toBeGreaterThanOrEqual(2);

    const spaced = tryRoute(
      [pub("p1", 0, 0), pub("p2", 8, 0), pub("p3", 16, 0), pub("p4", 24, 0)],
      { minLegMinutes: 5 },
    );
    expect(spaced.shortLegs).toBe(0);
    expect(spaced.worstRun).toBe(0);
  });

  it("counts the walk home on a loop and not on a path", () => {
    const stops = [pub("p1", 0, 0), pub("p2", 6, 0), pub("p3", 6, 6)];
    const path = tryRoute(stops, { shape: "path" });
    const loop = tryRoute(stops, { shape: "loop" });
    expect(loop.legs).toHaveLength(path.legs.length + 1);
    expect(loop.totalMinutes).toBeGreaterThan(path.totalMinutes);
  });

  it("says which pubs it could not place rather than quietly dropping them", () => {
    const trial = tryRoute([
      pub("p1", 0, 0),
      { id: "p2", lat: null, lng: null },
      pub("p3", 6, 0),
    ]);
    expect(trial.unplaced).toEqual(["p2"]);
    expect(trial.order).toContain("p2");
  });

  it("promises what the finished card will actually walk like", () => {
    // A trial that routed differently from the real thing is worse than no
    // trial: the caddy optimises against a walk nobody takes, and the tool's
    // own description promises otherwise in as many words.
    //
    // **This test used to compare against `orderWalk` alone — the half that
    // agreed.** `parsePlan` runs `orderWalk` and then `forwardOrder`, so the
    // second pass was the one that made the promise false, and the assertion
    // was written against exactly the part that could not catch it. Comparing
    // against the real pipeline is the whole point.
    const stops = [pub("p1", 0, 0), pub("p2", 9, 2), pub("p3", 3, 7), pub("p4", 7, 1)];
    const pins = { minLegMinutes: 5 } as const;
    const asTheCardWalksIt = forwardOrder(orderWalk(stops, pins), {
      first: false,
      last: false,
    }).map((stop) => stop.id);
    expect(tryRoute(stops, pins).order).toEqual(asTheCardWalksIt);
  });

  it("reports a walk that never doubles back", () => {
    // The property the second pass exists for, asserted on the trial rather
    // than only on the card — a shape where the two passes genuinely disagree.
    const zigzag = [
      pub("p1", 0, 0),
      pub("p2", 8, 0.4),
      pub("p3", 2, 0.1),
      pub("p4", 6, 0.3),
      pub("p5", 4, 0.2),
    ];
    const trial = tryRoute(zigzag, { minLegMinutes: 0 });
    const byId = new Map(zigzag.map((s) => [s.id, s]));
    const walked = trial.order.map((id) => byId.get(id)!);
    for (let i = 1; i < walked.length; i += 1) {
      expect(
        walked[i].lng!,
        `hole ${i + 1} steps back to ${trial.order[i]}`,
      ).toBeGreaterThanOrEqual(walked[i - 1].lng! - 1e-9);
    }
  });

  it("turns spacing off when the host asked for none", () => {
    const doorstep = tryRoute([pub("p1", 0, 0), pub("p2", 0.2, 0)], {
      minLegMinutes: 0,
    });
    expect(doorstep.shortLegs).toBe(0);
    expect(doorstep.worstRun).toBe(0);
  });
});

describe("forwardOrder", () => {
  /** The real card that prompted this, in the order it shipped: 2.47km of
   * walking to cover 0.97km of ground, running forward and back three times
   * along its own line. Every pub was good; the sequence was not. */
  const SHOREDITCH = [
    { venue_id: "1", lat: 51.52441, lng: -0.08013 },
    { venue_id: "2", lat: 51.52685, lng: -0.07822 },
    { venue_id: "3", lat: 51.52274, lng: -0.07801 },
    { venue_id: "4", lat: 51.52655, lng: -0.08018 },
    { venue_id: "5", lat: 51.52616, lng: -0.08110 },
    { venue_id: "6", lat: 51.52250, lng: -0.07818 },
    { venue_id: "7", lat: 51.52238, lng: -0.07778 },
    { venue_id: "8", lat: 51.51935, lng: -0.07429 },
    { venue_id: "9", lat: 51.51692, lng: -0.07302 },
  ];

  function positions(stops: typeof SHOREDITCH) {
    const first = stops[0];
    const last = stops[stops.length - 1];
    const scale = Math.cos(first.lat * (Math.PI / 180));
    const ax = (last.lng - first.lng) * scale;
    const ay = last.lat - first.lat;
    const len = Math.hypot(ax, ay);
    return stops.map(
      (stop) =>
        (((stop.lng - first.lng) * scale * ax + (stop.lat - first.lat) * ay) / len) *
        111.32,
    );
  }

  it("turns the real backtracking card into one continuous walk", () => {
    const before = positions(SHOREDITCH);
    // Proof the fixture is the bug: it goes forward, back, forward, back.
    expect(before.some((t, i) => i > 0 && t < before[i - 1])).toBe(true);

    const after = positions(forwardOrder(SHOREDITCH) as typeof SHOREDITCH);
    for (let i = 1; i < after.length; i += 1) {
      expect(after[i], `hole ${i + 1} steps backwards`).toBeGreaterThanOrEqual(
        after[i - 1],
      );
    }
  });

  it("holds a pinned tee and moves everything else", () => {
    // Pins are the host's. Without them every stop is free to move, which is
    // what makes the whole walk monotone rather than merely its middle — an
    // earlier cut fixed the ends unconditionally and the card still opened by
    // walking 200m the wrong way.
    const pinned = forwardOrder(SHOREDITCH, { first: true, last: true });
    expect(pinned[0].venue_id).toBe("1");
    expect(pinned[pinned.length - 1].venue_id).toBe("9");

    const free = forwardOrder(SHOREDITCH);
    expect(free[0].venue_id).not.toBe("1");
  });

  it("loses nothing and invents nothing", () => {
    const walked = forwardOrder(SHOREDITCH);
    expect(walked).toHaveLength(SHOREDITCH.length);
    expect(new Set(walked.map((stop) => stop.venue_id))).toEqual(
      new Set(SHOREDITCH.map((stop) => stop.venue_id)),
    );
  });

  it("leaves a walk with no interior alone", () => {
    const two = SHOREDITCH.slice(0, 2);
    expect(forwardOrder(two)).toEqual(two);
    const three = SHOREDITCH.slice(0, 3);
    expect(forwardOrder(three)).toEqual(three);
  });

  it("leaves a walk with no width alone", () => {
    // Every stop in one spot: no line to sort along, so nothing to sort.
    const stack = [0, 1, 2, 3].map(() => ({ ...SHOREDITCH[0] }));
    expect(forwardOrder(stack)).toEqual(stack);
  });
});
