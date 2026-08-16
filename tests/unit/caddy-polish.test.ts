import { describe, expect, it } from "vitest";

import { legCrossesBarrier, walkCrossings, type Barrier } from "@/lib/caddy/barriers";
import { classifyPatch, shapeNote } from "@/lib/caddy/shape";
import { readBrief } from "@/lib/caddy/brief";
import { paretoFront, buildRouteGraph } from "@/lib/caddy/route-graph";
import {
  buildCandidates,
  EMPTY_FACTS,
  type PubSource,
} from "@/lib/caddy/dossier";

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

// ————————————————— barriers —————————————————

describe("barriers", () => {
  // A river running east-west at 51.505, with one bridge at lng -0.07.
  const RIVER: Barrier = {
    line: [
      { lat: 51.505, lng: -0.12 },
      { lat: 51.505, lng: -0.02 },
    ],
    gates: [{ lat: 51.505, lng: -0.07 }],
    gateKm: 0.15,
  };
  const north = { lat: 51.51, lng: -0.1 };
  const south = { lat: 51.5, lng: -0.1 };

  it("calls a swim a swim, and a bridge a walk", () => {
    expect(legCrossesBarrier(north, south, RIVER)).toBe(true);
    // The same crossing, made at the bridge.
    expect(
      legCrossesBarrier(
        { lat: 51.51, lng: -0.0705 },
        { lat: 51.5, lng: -0.0702 },
        RIVER,
      ),
    ).toBe(false);
    // A leg that stays on one bank never crosses.
    expect(
      legCrossesBarrier(north, { lat: 51.512, lng: -0.05 }, RIVER),
    ).toBe(false);
  });

  it("counts a walk's unexcused crossings", () => {
    const stops = [north, south, { lat: 51.512, lng: -0.09 }];
    expect(walkCrossings(stops, [RIVER])).toBe(2);
  });

  it("the router keeps walks dry when it can", () => {
    // Six pubs north of the river, one juicy pub south of it, no bridge
    // nearby: with the barrier declared, no offered walk swims.
    const north6 = Array.from({ length: 6 }, (_, i) =>
      source(i + 1, { lat: 51.51, lng: -0.1 - i * 0.003 }),
    );
    const south1 = source(9, { lat: 51.5, lng: -0.106 });
    const graph = buildRouteGraph(buildCandidates([...north6, south1]), {
      holes: 4,
      targetKm: 1.5,
      barriers: [
        { ...RIVER, gates: [] },
      ],
    });
    expect(graph.routes.length).toBeGreaterThan(0);
    const southId = "p7";
    for (const route of graph.routes) {
      expect(route.stops).not.toContain(southId);
    }
  });
});

// ————————————————— shape —————————————————

describe("classifyPatch", () => {
  it("calls one cloud a blob", () => {
    const blob = Array.from({ length: 12 }, (_, i) => ({
      lat: 51.5 + (i % 4) * 0.002,
      lng: -0.07 - Math.floor(i / 4) * 0.003,
    }));
    expect(classifyPatch(blob).kind).toBe("blob");
    expect(shapeNote({ kind: "blob" })).toBeNull();
  });

  it("sees two pockets with a march between", () => {
    const pocket = (lng: number) =>
      Array.from({ length: 5 }, (_, i) => ({ lat: 51.5 + i * 0.001, lng }));
    const shape = classifyPatch([...pocket(-0.1), ...pocket(-0.07)]);
    expect(shape.kind).toBe("pockets");
    if (shape.kind === "pockets") {
      expect(shape.gapKm).toBeGreaterThan(1);
      expect(shapeNote(shape)).toContain("Two pockets");
    }
  });

  it("sees one street for what it is", () => {
    const street = Array.from({ length: 10 }, (_, i) => ({
      lat: 51.5 + i * 0.0001,
      lng: -0.1 + i * 0.004,
    }));
    expect(classifyPatch(street).kind).toBe("line");
  });
});

// ————————————————— pareto —————————————————

describe("paretoFront", () => {
  it("keeps every offered walk on the front", () => {
    const pubs = Array.from({ length: 14 }, (_, i) =>
      source(i + 1, {
        lat: 51.5 + (i % 3) * 0.0015,
        lng: -0.07 - i * 0.0025,
      }),
    );
    const candidates = buildCandidates(pubs);
    const graph = buildRouteGraph(candidates, { holes: 6, targetKm: 2 });
    expect(graph.routes.length).toBeGreaterThan(0);
    // The menu was chosen from the non-dominated set, so re-running the
    // front over the menu itself removes nothing.
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const front = paretoFront(graph.routes, nodes, 2);
    expect(front.length).toBe(graph.routes.length);
  });
});

// ————————————————— exclusions —————————————————

describe("excluded venues on the brief", () => {
  it("reads only plausible ids, capped", () => {
    const good = "00000000-0000-4000-8000-000000000001";
    const brief = readBrief({
      where: "Camden",
      excludedVenueIds: [good, "not-an-id", 42, null],
    })!;
    expect(brief.excludedVenueIds).toEqual([good]);
    const flood = readBrief({
      where: "Camden",
      excludedVenueIds: Array.from({ length: 40 }, () => good),
    })!;
    expect(flood.excludedVenueIds.length).toBeLessThanOrEqual(20);
  });
});
