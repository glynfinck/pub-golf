import { describe, expect, it } from "vitest";

import type { CandidateDossier } from "@/lib/caddy/dossier";
import { buildRouteGraph, principalAxis, routableNodes } from "@/lib/caddy/route-graph";
import { forwardOrder, orderWalk, walkKm, type WalkStop } from "@/lib/caddy/route";
import { corridorSamples } from "@/lib/geo";

/**
 * The routing, tested by property rather than by example.
 *
 * Every example test in this repo was written after a real card came back
 * wrong, and each one nailed down the case that had already escaped. That is
 * worth having and it is not coverage: the failures here were all in patch
 * shapes nobody thought to write down — pubs in a ring, pubs in two clumps
 * with a gap, one pub miles from the rest.
 *
 * So this generates hundreds of patches and asserts what must hold for all of
 * them. No `Math.random`: the generator below is a seeded LCG, so a failure is
 * reproducible from the seed printed in the message rather than being a story
 * about a run nobody can repeat.
 */

/** Numerical Recipes' LCG. Deterministic, and adequate for scattering points. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const LONDON = { lat: 51.52, lng: -0.08 };
/** Degrees per kilometre, near enough at this latitude for a fixture. */
const DEG_LAT = 1 / 111.32;
const DEG_LNG = 1 / (111.32 * Math.cos((LONDON.lat * Math.PI) / 180));

function at(km: { x: number; y: number }, index: number): CandidateDossier {
  return {
    id: `p${index}`,
    venueId: `venue_${index}`,
    name: `Pub ${index}`,
    address: null,
    rating: 4,
    reviewCount: 100,
    lat: LONDON.lat + km.y * DEG_LAT,
    lng: LONDON.lng + km.x * DEG_LNG,
    priceLevel: 2,
    facts: {} as CandidateDossier["facts"],
    editorial: null,
    reviews: [],
  };
}

/**
 * The patch shapes that break routers, rather than the one that does not.
 *
 * A uniform scatter is the easy case and the only one an author invents
 * unprompted. A ring has no long axis worth the name; two clumps tempt a
 * router to hop between them; a spur is one pub far enough away to drag any
 * distance-minimising order out and back.
 */
const SHAPES = ["scatter", "street", "ring", "clumps", "spur", "grid"] as const;

function patch(shape: (typeof SHAPES)[number], count: number, next: () => number) {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / Math.max(count - 1, 1);
    if (shape === "scatter") {
      points.push({ x: (next() - 0.5) * 2, y: (next() - 0.5) * 2 });
    } else if (shape === "street") {
      points.push({ x: t * 2 - 1 + (next() - 0.5) * 0.1, y: (next() - 0.5) * 0.15 });
    } else if (shape === "ring") {
      const angle = t * Math.PI * 2;
      points.push({ x: Math.cos(angle) * 0.8, y: Math.sin(angle) * 0.8 });
    } else if (shape === "clumps") {
      const side = i % 2 === 0 ? -0.9 : 0.9;
      points.push({ x: side + (next() - 0.5) * 0.3, y: (next() - 0.5) * 0.3 });
    } else if (shape === "spur") {
      points.push(i === 0 ? { x: 3, y: 3 } : { x: (next() - 0.5) * 0.8, y: (next() - 0.5) * 0.8 });
    } else {
      points.push({ x: (i % 4) * 0.4 - 0.6, y: Math.floor(i / 4) * 0.4 - 0.6 });
    }
  }
  return points.map(at);
}

/**
 * How far along a patch's widest line each stop sits.
 *
 * The axis is taken from `reference` — the stops as they went *in* — rather
 * than from the walk that came out. `forwardOrder` derives it from its own
 * input, and on a shape with several equally-widest pairs (a ring is the
 * obvious one) scanning a reordered array can settle on a different pair and
 * measure the answer against an axis it was never sorted along. That is a
 * measurement bug and it read exactly like a routing bug, which is the whole
 * reason to be careful here.
 */
function positions(stops: WalkStop[], reference: WalkStop[] = stops): number[] {
  const placed = reference.filter(
    (stop): stop is WalkStop & { lat: number; lng: number } =>
      stop.lat != null && stop.lng != null,
  );
  let a = placed[0];
  let b = placed[1];
  let widest = -1;
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const dx = (placed[j].lng - placed[i].lng) / DEG_LNG;
      const dy = (placed[j].lat - placed[i].lat) / DEG_LAT;
      const span = dx * dx + dy * dy;
      if (span > widest) {
        widest = span;
        a = placed[i];
        b = placed[j];
      }
    }
  }
  const ax = (b.lng - a.lng) / DEG_LNG;
  const ay = (b.lat - a.lat) / DEG_LAT;
  const len = Math.hypot(ax, ay) || 1;
  return stops.map((stop) => {
    if (stop.lat == null || stop.lng == null) return Number.POSITIVE_INFINITY;
    return (((stop.lng - a.lng) / DEG_LNG) * ax + ((stop.lat - a.lat) / DEG_LAT) * ay) / len;
  });
}

/** Every (shape, seed) pair, so a failure names the patch that caused it. */
const CASES = SHAPES.flatMap((shape) =>
  [1, 7, 42, 1234, 99999].map((seed) => ({ shape, seed })),
);

describe("forwardOrder holds for any patch", () => {
  for (const { shape, seed } of CASES) {
    it(`${shape} / seed ${seed}`, () => {
      const next = rng(seed);
      const stops = patch(shape, 9, next).map((c) => ({
        venue_id: c.venueId,
        lat: c.lat,
        lng: c.lng,
      }));
      const walked = forwardOrder(stops);

      // A permutation: nothing lost, nothing duplicated, nothing invented.
      expect(walked).toHaveLength(stops.length);
      expect(new Set(walked.map((s) => s.venue_id))).toEqual(
        new Set(stops.map((s) => s.venue_id)),
      );

      // Monotone along the walk's own line — the whole point.
      //
      // Except on a ring, where the property is simply false: points evenly
      // round a circle have *no* monotone ordering, because any walk visiting
      // all of them must come back the way it went. That is a fact about the
      // shape rather than a fault in the router, and it is the reason a ring
      // is in this suite — a patch shaped like one cannot be given a walk that
      // only goes forward, and pretending otherwise would mean a test that can
      // never pass or a router that quietly drops stops to make it.
      if (shape !== "ring") {
        const along = positions(walked, stops);
        for (let i = 1; i < along.length; i += 1) {
          expect(
            along[i],
            `${shape}/${seed}: hole ${i + 1} steps back`,
          ).toBeGreaterThanOrEqual(along[i - 1] - 1e-9);
        }
      }

      // Settled: ordering an ordered walk changes nothing.
      expect(forwardOrder(walked).map((s) => s.venue_id)).toEqual(
        walked.map((s) => s.venue_id),
      );
    });
  }

  it("keeps pinned tees on every shape", () => {
    for (const { shape, seed } of CASES) {
      const stops = patch(shape, 9, rng(seed)).map((c) => ({
        venue_id: c.venueId,
        lat: c.lat,
        lng: c.lng,
      }));
      const walked = forwardOrder(stops, { first: true, last: true });
      expect(walked[0].venue_id, `${shape}/${seed}`).toBe(stops[0].venue_id);
      expect(walked[walked.length - 1].venue_id, `${shape}/${seed}`).toBe(
        stops[stops.length - 1].venue_id,
      );
    }
  });

  it("survives stops with no coordinates", () => {
    // A pub added by name has no position. It must not be dropped, duplicated,
    // or sorted to a place that pretends it has one.
    const stops = patch("street", 6, rng(3)).map((c) => ({
      venue_id: c.venueId,
      lat: c.lat,
      lng: c.lng,
    }));
    const mixed = [...stops, { venue_id: "nowhere", lat: null, lng: null }];
    const walked = forwardOrder(mixed);
    expect(walked).toHaveLength(mixed.length);
    expect(new Set(walked.map((stop) => stop.venue_id))).toEqual(
      new Set(mixed.map((stop) => stop.venue_id)),
    );
  });
});

describe("buildRouteGraph holds for any patch", () => {
  for (const { shape, seed } of CASES) {
    it(`${shape} / seed ${seed}`, () => {
      const candidates = patch(shape, 14, rng(seed));
      const known = new Set(candidates.map((c) => c.id));
      const graph = buildRouteGraph(candidates, { holes: 6, routes: 8 });

      expect(graph.routes.length).toBeGreaterThan(0);
      for (const route of graph.routes) {
        // The rule the whole feature exists under, on every shape.
        for (const stop of route.stops) {
          expect(known.has(stop), `${shape}/${seed}: invented ${stop}`).toBe(true);
        }
        expect(new Set(route.stops).size, `${shape}/${seed}: repeated a pub`).toBe(
          route.stops.length,
        );
        expect(route.stops).toHaveLength(6);
        expect(route.totalKm).toBeGreaterThan(0);
        expect(Number.isFinite(route.totalKm)).toBe(true);
        expect(Number.isFinite(route.detour)).toBe(true);
      }
      // Distinct characters, or the menu is offering one thing many times.
      const characters = graph.routes.map((route) => route.character);
      expect(new Set(characters).size).toBe(characters.length);
    });
  }

  it("honours pinned tees on every shape", () => {
    for (const { shape, seed } of CASES) {
      const candidates = patch(shape, 14, rng(seed));
      const graph = buildRouteGraph(candidates, {
        holes: 5,
        startId: candidates[0].id,
        finishId: candidates[candidates.length - 1].id,
        routes: 6,
      });
      for (const route of graph.routes) {
        expect(route.stops[0], `${shape}/${seed}`).toBe(candidates[0].id);
        expect(route.stops.at(-1), `${shape}/${seed}`).toBe(
          candidates[candidates.length - 1].id,
        );
      }
    }
  });

  it("finds a walk that gets somewhere, except where the shape forbids it", () => {
    for (const { shape, seed } of CASES) {
      // A ring has no line through it and a clump pair is two places, not a
      // walk — those are patches, not routing failures, and are exempt.
      if (shape === "ring" || shape === "clumps") continue;
      const graph = buildRouteGraph(patch(shape, 14, rng(seed)), {
        holes: 6,
        routes: 8,
      });
      const best = Math.min(...graph.routes.map((route) => route.detour));
      expect(best, `${shape}/${seed}: nothing on the menu goes anywhere`).toBeLessThan(2);
    }
  });

  it("never returns fewer stops than asked for, or more", () => {
    for (const holes of [2, 3, 5, 9]) {
      const graph = buildRouteGraph(patch("scatter", 14, rng(11)), { holes, routes: 5 });
      for (const route of graph.routes) expect(route.stops).toHaveLength(holes);
    }
  });

  it("gives a stable answer for the same patch", () => {
    // Same candidates in, same routes out. The block sits in the cached prefix,
    // so an unstable router would miss cache on every turn of a plan.
    const candidates = patch("scatter", 14, rng(77));
    const once = buildRouteGraph(candidates, { holes: 6, routes: 6 });
    const twice = buildRouteGraph(candidates, { holes: 6, routes: 6 });
    expect(twice.routes.map((r) => r.stops)).toEqual(once.routes.map((r) => r.stops));
  });
});

describe("principalAxis holds for any patch", () => {
  it("always returns a unit vector", () => {
    for (const { shape, seed } of CASES) {
      const axis = principalAxis(routableNodes(patch(shape, 12, rng(seed))));
      expect(Math.hypot(axis.x, axis.y), `${shape}/${seed}`).toBeCloseTo(1, 6);
    }
  });

  it("finds the street when there is one", () => {
    // Pubs strung east-west must give an east-west axis, whatever the seed.
    for (const seed of [1, 7, 42]) {
      const axis = principalAxis(routableNodes(patch("street", 12, rng(seed))));
      expect(Math.abs(axis.x)).toBeGreaterThan(Math.abs(axis.y));
    }
  });

  it("does not fall over on a single point or an empty patch", () => {
    expect(() => principalAxis(routableNodes(patch("scatter", 1, rng(1))))).not.toThrow();
    expect(() => principalAxis([])).not.toThrow();
  });
});

describe("orderWalk and forwardOrder agree about what they are given", () => {
  it("neither loses a stop, on any shape", () => {
    for (const { shape, seed } of CASES) {
      const stops = patch(shape, 8, rng(seed)).map((c) => ({
        venue_id: c.venueId,
        lat: c.lat,
        lng: c.lng,
      }));
      const ordered = orderWalk(stops);
      const walked = forwardOrder(ordered);
      expect(new Set(walked.map((stop) => stop.venue_id)), `${shape}/${seed}`).toEqual(
        new Set(stops.map((s) => s.venue_id)),
      );
      expect(walkKm(walked)).toBeGreaterThan(0);
    }
  });
});

describe("corridorSamples", () => {
  it("covers a long walk instead of gathering only its ends", () => {
    // Finsbury Park to Broadway Market is about 4km. A handful of circles at
    // corridor width has to reach all the way along it — anything less is a
    // corridor with a hole in the middle, which routes as a march between two
    // clumps because that is genuinely all the gather found.
    expect(corridorSamples(4)).toBeGreaterThan(3);
    // Enough that the circles overlap rather than leaving gaps between them.
    expect(corridorSamples(4) * 0.6 * 1.4).toBeGreaterThanOrEqual(4);
  });

  it("still takes three for a short hop", () => {
    expect(corridorSamples(0.5)).toBe(3);
    expect(corridorSamples(0)).toBe(3);
  });

  it("refuses to fire off a search per street", () => {
    // A pair of areas on opposite sides of the country must not turn into
    // thirty Places calls on one plan. The cap is the corridor's, and it is
    // higher than it was because the circles are narrower.
    expect(corridorSamples(400)).toBeLessThanOrEqual(12);
  });

  it("widens its stride when the circles are wider", () => {
    // The radius is the caller's: a corridor is searched at half the width of
    // a single patch, and the sample count has to know that or it leaves gaps.
    expect(corridorSamples(4, 1.2)).toBeLessThan(corridorSamples(4, 0.6));
  });

  it("never returns something unusable", () => {
    for (const km of [0, 0.1, 1, 2.4, 3.7, 12, 100]) {
      const n = corridorSamples(km);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(3);
    }
  });
});
