import { describe, expect, it } from "vitest";

import {
  arrivalMinute,
  DWELL_MINUTES,
  LAST_ORDERS_MARGIN,
  openAt,
  openFor,
  windowsOf,
  type OpenWindow,
} from "@/lib/caddy/hours";
import { readBrief } from "@/lib/caddy/brief";
import {
  buildCandidates,
  EMPTY_FACTS,
  type PubSource,
} from "@/lib/caddy/dossier";
import { buildRouteGraph, walkFeasible } from "@/lib/caddy/route-graph";

// ————————————————— parsing —————————————————

describe("windowsOf", () => {
  it("folds Google's periods to windows, overnight closes riding past 1440", () => {
    const windows = windowsOf([
      { open: { day: 5, hour: 12, minute: 0 }, close: { day: 5, hour: 23, minute: 30 } },
      { open: { day: 6, hour: 12, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } },
    ]);
    expect(windows).toEqual([
      { day: 5, open: 720, close: 1410 },
      { day: 6, open: 720, close: 1560 },
    ]);
  });

  it("answers null for nothing, and for Google's always-open spelling", () => {
    expect(windowsOf(null)).toBeNull();
    expect(windowsOf([])).toBeNull();
    // An open with no close is "always open" — the whole answer is unknown.
    expect(windowsOf([{ open: { day: 0, hour: 0, minute: 0 } }])).toBeNull();
  });
});

// ————————————————— asking —————————————————

describe("openAt and openFor", () => {
  const fridayLate: OpenWindow[] = [{ day: 5, open: 1380, close: 1560 }]; // 23:00–02:00

  it("null hours are open — unknown is not shut", () => {
    expect(openAt(null, 5, 900)).toBe(true);
    expect(openFor(null, 5, 900)).toBeNull();
  });

  it("honours the previous evening's spill-over", () => {
    // 00:30 Saturday sits inside Friday's 23:00–02:00.
    expect(openAt(fridayLate, 6, 30)).toBe(true);
    expect(openFor(fridayLate, 6, 30)).toBe(90);
    // 02:30 Saturday does not.
    expect(openAt(fridayLate, 6, 150)).toBe(false);
    expect(openFor(fridayLate, 6, 150)).toBe(0);
  });

  it("folds an ETA that crossed midnight onto the next day", () => {
    // Asked about Friday at minute 1470 (= 00:30 Saturday).
    expect(openAt(fridayLate, 5, 1470)).toBe(true);
  });

  it("shut before opening and after closing", () => {
    expect(openAt(fridayLate, 5, 1379)).toBe(false);
    expect(openAt(fridayLate, 5, 1380)).toBe(true);
  });
});

describe("arrivalMinute", () => {
  it("is tee-off plus the walk plus a dwell per prior hole", () => {
    expect(arrivalMinute({ day: 5, minutes: 1140 }, 0, 0)).toBe(1140);
    expect(arrivalMinute({ day: 5, minutes: 1140 }, 12, 2)).toBe(
      1140 + 12 + 2 * DWELL_MINUTES,
    );
  });
});

// ————————————————— the router refuses a shut door —————————————————

function source(n: number, over: Partial<PubSource> = {}): PubSource {
  return {
    venueId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `The Pub ${n}`,
    address: `${n} Example Street`,
    rating: 4,
    reviewCount: 100,
    lat: 51.5,
    lng: -0.07 - n * 0.003,
    priceLevel: 2,
    facts: { ...EMPTY_FACTS },
    editorial: null,
    reviews: [],
    hours: null,
    ...over,
  };
}

describe("time-aware routing", () => {
  // Ten pubs up a street; one of them shuts at 19:15 on the round's day —
  // open at a 7pm tee-off, shut by the time any second hole is reached
  // (arrival at hole two is ~19:28: the walk plus one dwell).
  const EARLY_CLOSER = 4;
  const candidates = buildCandidates(
    Array.from({ length: 10 }, (_, i) =>
      source(i + 1, {
        hours:
          i + 1 === EARLY_CLOSER
            ? [{ day: 5, open: 720, close: 1155 }] // 12:00–19:15
            : [{ day: 5, open: 720, close: 1440 }],
      }),
    ),
  );
  const brief = readBrief({
    where: "Example Town",
    holes: 6,
    stretch: 3,
    teeOffDay: 5,
    teeOffMinutes: 1140,
  })!;

  it("keeps the early closer off every offered walk except hole one", () => {
    const graph = buildRouteGraph(candidates, {
      holes: brief.holes,
      targetKm: 1,
      teeOff: { day: brief.teeOffDay!, minutes: brief.teeOffMinutes },
    });
    expect(graph.routes.length).toBeGreaterThan(0);
    const earlyId = candidates.find(
      (c) => c.venueId.endsWith(String(EARLY_CLOSER).padStart(12, "0")),
    )!.id;
    for (const route of graph.routes) {
      const at = route.stops.indexOf(earlyId);
      // Reaching it any later than the first hole means arriving after 19:30.
      expect(at <= 0).toBe(true);
    }
  });

  it("walkFeasible holds the finish to the last-orders margin", () => {
    const graph = buildRouteGraph(candidates, { holes: 3, targetKm: 0.5 });
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const table = new Map(
      graph.nodes.map((a) => [
        a.id,
        new Map(graph.nodes.map((b) => [b.id, 0.1])),
      ]),
    );
    const stops = graph.nodes.slice(0, 3).map((n) => n.id);
    // Finishing pub shuts at 21:00; arrival ~20:52 leaves under the margin.
    const finish = nodes.get(stops[2])!;
    finish.hours = [{ day: 5, open: 720, close: 1260 }];
    const arrivalAtFinish = 1200 + 2 * DWELL_MINUTES; // walks ≈ 3 min
    expect(1260 - arrivalAtFinish).toBeLessThan(LAST_ORDERS_MARGIN);
    expect(
      walkFeasible(table, nodes, stops, { day: 5, minutes: 1200 }),
    ).toBe(false);
    // The same walk two hours earlier is fine.
    expect(
      walkFeasible(table, nodes, stops, { day: 5, minutes: 1080 }),
    ).toBe(true);
  });

  it("no day named means no hours checks at all", () => {
    const graph = buildRouteGraph(candidates, { holes: 6, targetKm: 1 });
    expect(graph.routes.length).toBeGreaterThan(0);
  });
});
