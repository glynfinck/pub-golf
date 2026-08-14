import { describe, expect, it } from "vitest";

import {
  alongStrokeKm,
  distanceToStrokeKm,
  readStroke,
  simplifyStroke,
  strokeCircles,
  strokeLengthKm,
  STROKE_MAX_CIRCLES,
  STROKE_MAX_POINTS,
} from "@/lib/caddy/stroke";
import { readBrief } from "@/lib/caddy/brief";
import {
  buildCandidates,
  EMPTY_FACTS,
  type PubSource,
} from "@/lib/caddy/dossier";
import { buildRouteGraph } from "@/lib/caddy/route-graph";

// A bent walk through east London: west, then north — an L the straight
// corridor cannot express.
const L_STROKE = [
  { lat: 51.5, lng: -0.08 },
  { lat: 51.5, lng: -0.06 },
  { lat: 51.515, lng: -0.06 },
];

describe("simplifyStroke", () => {
  it("keeps the shape and sheds the wobble", () => {
    // A straightish line drawn with a shaky hand: many points, tiny noise.
    const wobbly = Array.from({ length: 120 }, (_, i) => ({
      lat: 51.5 + (i % 2) * 0.00005,
      lng: -0.08 + i * 0.0002,
    }));
    const simple = simplifyStroke(wobbly, 0.15);
    expect(simple.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    expect(simple.length).toBeGreaterThanOrEqual(2);
    expect(simple[0]).toEqual(wobbly[0]);
    expect(simple[simple.length - 1]).toEqual(wobbly[wobbly.length - 1]);
  });

  it("keeps a genuine corner", () => {
    const simple = simplifyStroke(
      [
        { lat: 51.5, lng: -0.08 },
        { lat: 51.5, lng: -0.07 },
        { lat: 51.5, lng: -0.06 },
        { lat: 51.508, lng: -0.06 },
        { lat: 51.515, lng: -0.06 },
      ],
      0.15,
    );
    // The corner at (-0.06, 51.5) survives; the mid-edge points go.
    expect(simple).toContainEqual({ lat: 51.5, lng: -0.06 });
    expect(simple.length).toBe(3);
  });
});

describe("strokeCircles", () => {
  it("covers the line end to end, capped", () => {
    const centres = strokeCircles(L_STROKE, 0.6);
    expect(centres.length).toBeLessThanOrEqual(STROKE_MAX_CIRCLES);
    expect(centres.length).toBeGreaterThanOrEqual(2);
    expect(centres[0]).toEqual(L_STROKE[0]);
    expect(centres[centres.length - 1]).toEqual(L_STROKE[L_STROKE.length - 1]);
    // Every centre sits on the stroke.
    for (const centre of centres) {
      expect(distanceToStrokeKm(centre, L_STROKE)).toBeLessThan(0.02);
    }
  });

  it("widens the spacing rather than the bill on a long stroke", () => {
    const long = [
      { lat: 51.5, lng: -0.2 },
      { lat: 51.5, lng: 0.0 }, // ~14km
    ];
    expect(strokeCircles(long, 0.6).length).toBe(STROKE_MAX_CIRCLES);
  });
});

describe("alongStrokeKm", () => {
  it("orders points the way the stroke was drawn, round the bend", () => {
    const early = { lat: 51.5, lng: -0.075 }; // on the first arm
    const corner = { lat: 51.5, lng: -0.0605 };
    const late = { lat: 51.512, lng: -0.06 }; // up the second arm
    const a = alongStrokeKm(early, L_STROKE);
    const b = alongStrokeKm(corner, L_STROKE);
    const c = alongStrokeKm(late, L_STROKE);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

describe("readStroke", () => {
  it("accepts a plausible drawn line and nothing else", () => {
    expect(readStroke(L_STROKE)).toEqual(L_STROKE);
    expect(readStroke(null)).toBeNull();
    expect(readStroke([{ lat: 51.5, lng: -0.08 }])).toBeNull();
    expect(readStroke([{ lat: "x", lng: -0.08 }, { lat: 51.5, lng: -0.07 }])).toBeNull();
    expect(readStroke([{ lat: 99, lng: -0.08 }, { lat: 51.5, lng: -0.07 }])).toBeNull();
    // A stroke across the country is a joke, not a crawl.
    expect(
      readStroke([
        { lat: 51.5, lng: -0.08 },
        { lat: 53.48, lng: -2.24 },
      ]),
    ).toBeNull();
  });

  it("lands on the brief and takes over the reach", () => {
    const brief = readBrief({ stroke: L_STROKE, holes: 6 })!;
    expect(brief).not.toBeNull();
    expect(brief.stroke).toEqual(L_STROKE);
    expect(brief.reachKm).toBeCloseTo(strokeLengthKm(L_STROKE), 1);
  });
});

describe("the stroke is the axis", () => {
  function source(n: number, at: { lat: number; lng: number }): PubSource {
    return {
      venueId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      name: `The Pub ${n}`,
      address: null,
      rating: 4,
      reviewCount: 100,
      lat: at.lat,
      lng: at.lng,
      priceLevel: 2,
      facts: { ...EMPTY_FACTS },
      editorial: null,
      reviews: [],
      hours: null,
    };
  }

  it("routes forward along a bend the straight axis cannot see", () => {
    // Pubs strung along the L: along the first arm, round the corner, up the
    // second. A straight principal axis would fold the two arms together;
    // the stroke keeps them in drawn order.
    const spots = [
      { lat: 51.5, lng: -0.078 },
      { lat: 51.5, lng: -0.072 },
      { lat: 51.5, lng: -0.066 },
      { lat: 51.5005, lng: -0.0605 },
      { lat: 51.505, lng: -0.06 },
      { lat: 51.509, lng: -0.0602 },
      { lat: 51.513, lng: -0.0598 },
    ];
    const candidates = buildCandidates(spots.map((at, i) => source(i + 1, at)));
    const graph = buildRouteGraph(candidates, {
      holes: 5,
      targetKm: 3,
      stroke: L_STROKE,
    });
    expect(graph.routes.length).toBeGreaterThan(0);
    const positions = new Map(
      candidates.map((c) => [
        c.id,
        alongStrokeKm({ lat: c.lat!, lng: c.lng! }, L_STROKE),
      ]),
    );
    // At least one offered walk is monotone along the drawn line — the
    // snakes are constructed that way and survive the menu.
    const monotone = graph.routes.some((route) => {
      let last = -1;
      for (const stop of route.stops) {
        const at = positions.get(stop)!;
        if (at < last) return false;
        last = at;
      }
      return true;
    });
    expect(monotone).toBe(true);
  });
});
