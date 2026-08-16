import { describe, expect, it } from "vitest";

import type { CandidateDossier } from "@/lib/caddy/dossier";
import { interleaveRings } from "@/lib/caddy/rings";
import {
  bestStrokeWalk,
  buildRouteGraph,
  followsStroke,
  routableNodes,
  STROKE_COVERAGE_FLOOR,
} from "@/lib/caddy/route-graph";
import {
  alongStrokeKm,
  distanceToStrokeKm,
  strokeFit,
  strokeLengthKm,
  type StrokePoint,
} from "@/lib/caddy/stroke";

/**
 * Drawing a walk and being handed one street of it.
 *
 * The report was "the route doesn't follow the path I drew — it just picks
 * something inside the area". Two separate causes, both held here, because
 * fixing either alone still leaves the same screen:
 *
 *   **The gather threw the line away.** Circles are sampled down the stroke
 *   and their answers were concatenated in circle order, then cut to the
 *   candidate cap — so the opening circles filled the budget and the far end
 *   of the host's line never became a candidate at all.
 *
 *   **Selection never asked.** The stroke reached construction (forward walks
 *   are monotone along it) but not the menu, and a tight cluster inside the
 *   swath is short, well-connected and wins on nearly every objective.
 */

const STEP = 0.009;

function pub(
  id: string,
  lat: number,
  lng: number,
  rating = 4,
): CandidateDossier {
  return {
    id,
    venueId: `venue_${id}`,
    name: id,
    address: null,
    rating,
    reviewCount: 100,
    lat,
    lng,
    priceLevel: 2,
    facts: {} as CandidateDossier["facts"],
    editorial: null,
    reviews: [],
  };
}

// ————————————————— the gather's budget —————————————————

describe("interleaveRings", () => {
  it("spends a bounded budget along the whole line, not on its head", () => {
    // Twelve circles down a stroke, twenty pubs each — Google's real per-request
    // cap — against a forty-candidate budget.
    const rings = Array.from({ length: 12 }, (_, circle) =>
      Array.from({ length: 20 }, (_, rank) => `c${circle}r${rank}`),
    );

    const concatenated = rings.flat().slice(0, 40);
    const circlesReached = new Set(
      concatenated.map((entry) => entry.split("r")[0]),
    );
    // The bug, stated: two circles' worth. The other ten are off the card
    // before anything is routed.
    expect(circlesReached.size).toBe(2);

    const interleaved = interleaveRings(rings).slice(0, 40);
    expect(new Set(interleaved.map((e) => e.split("r")[0])).size).toBe(12);
  });

  it("keeps each ring's own order, and tolerates ragged ones", () => {
    const out = interleaveRings([["a1", "a2", "a3"], [], ["c1"]]);
    expect(out).toEqual(["a1", "c1", "a2", "a3"]);
  });

  it("is empty for no rings and for rings with nothing in them", () => {
    expect(interleaveRings([])).toEqual([]);
    expect(interleaveRings([[], []])).toEqual([]);
  });
});

// ————————————————— measuring the follow —————————————————

/** A straight two-kilometre-ish line, drawn west to east. */
const LINE: StrokePoint[] = [
  { lat: 51.5, lng: -0.1 },
  { lat: 51.5, lng: -0.1 + STEP * 4 },
];

describe("strokeFit", () => {
  it("scores a walk down the whole line at full coverage", () => {
    const walk = [0, 1, 2, 3, 4].map((i) => ({
      lat: 51.5,
      lng: -0.1 + STEP * i,
    }));
    const fit = strokeFit(walk, LINE);
    expect(fit.coverage).toBeCloseTo(1, 2);
    expect(fit.backtrackKm).toBeCloseTo(0, 4);
    expect(fit.worstGapKm).toBeLessThan(strokeLengthKm(LINE) / 3);
  });

  it("catches the walk that never leaves the first street", () => {
    const huddle = [0, 0.1, 0.2, 0.3].map((i) => ({
      lat: 51.5,
      lng: -0.1 + STEP * i,
    }));
    const fit = strokeFit(huddle, LINE);
    expect(fit.coverage).toBeLessThan(0.15);
    // And says where the line went unwalked: nearly all of it.
    expect(fit.worstGapKm).toBeGreaterThan(strokeLengthKm(LINE) * 0.9);
  });

  it("counts doubling back in walking order, not as a spread", () => {
    const there = [0, 2, 4].map((i) => ({ lat: 51.5, lng: -0.1 + STEP * i }));
    const zigzag = [0, 4, 2].map((i) => ({ lat: 51.5, lng: -0.1 + STEP * i }));
    // Same three pubs, so the same coverage — the order is the difference.
    expect(strokeFit(zigzag, LINE).coverage).toBeCloseTo(
      strokeFit(there, LINE).coverage,
      6,
    );
    expect(strokeFit(there, LINE).backtrackKm).toBeCloseTo(0, 4);
    expect(strokeFit(zigzag, LINE).backtrackKm).toBeGreaterThan(0.4);
  });

  it("never punishes what it cannot measure", () => {
    expect(strokeFit([], LINE).coverage).toBe(0);
    expect(followsStroke([{ lat: 51.5, lng: -0.1 }], [])).toBe(true);
  });
});

// ————————————————— the optimum —————————————————

/**
 * The heart of it, proved rather than eyeballed.
 *
 * Following a drawn line is an optimisation — choose k stops, in arc order,
 * minimising total distance from the line, subject to spacing — and an
 * optimisation is the one kind of behaviour a test can hold *exactly*: the
 * brute-force answer is computable at this size, so the router either finds it
 * or it does not. No "looks reasonable", no tolerance band.
 */
function bruteForceBest(
  nodes: ReturnType<typeof routableNodes>,
  holes: number,
  stroke: StrokePoint[],
  minGapKm: number,
): { stops: string[]; cost: number } | null {
  const placed = nodes
    .map((node) => ({
      id: node.id,
      along: alongStrokeKm({ lat: node.lat, lng: node.lng }, stroke),
      off: distanceToStrokeKm({ lat: node.lat, lng: node.lng }, stroke),
    }))
    .sort((a, b) => a.along - b.along || (a.id < b.id ? -1 : 1));

  let best: { stops: string[]; cost: number } | null = null;
  const pick: number[] = [];
  const walk = (from: number) => {
    if (pick.length === holes) {
      const cost = pick.reduce((sum, i) => sum + placed[i].off, 0);
      if (!best || cost < best.cost - 1e-12) {
        best = { stops: pick.map((i) => placed[i].id), cost };
      }
      return;
    }
    for (let i = from; i < placed.length; i += 1) {
      const previous = pick[pick.length - 1];
      if (
        pick.length > 0 &&
        placed[i].along - placed[previous].along < minGapKm - 1e-9
      ) {
        continue;
      }
      pick.push(i);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return best;
}

describe("bestStrokeWalk", () => {
  // Sixteen pubs scattered either side of a line: enough that the greedy and
  // the optimal answers genuinely differ, small enough to enumerate.
  const SCATTER = Array.from({ length: 16 }, (_, i) =>
    pub(
      `s${i}`,
      // Alternating, uneven offsets from the line — so "nearest to the line"
      // and "evenly spaced" pull in different directions.
      51.5 + (i % 4) * 0.0007 * (i % 2 === 0 ? 1 : -1),
      -0.1 + STEP * 0.27 * i,
      3.5 + (i % 5) * 0.3,
    ),
  );
  const nodes = routableNodes(SCATTER);

  const costOf = (stops: string[]) =>
    stops.reduce((sum, id) => {
      const node = nodes.find((entry) => entry.id === id)!;
      return sum + distanceToStrokeKm({ lat: node.lat, lng: node.lng }, DRAWN);
    }, 0);

  it("finds the true optimum, not a good-looking one", () => {
    let compared = 0;
    for (const holes of [4, 5, 6]) {
      for (const minGapKm of [0, 0.2, 0.5]) {
        const found = bestStrokeWalk(nodes, holes, DRAWN, { minGapKm });
        const truth = bruteForceBest(nodes, holes, DRAWN, minGapKm);
        // Agreeing that a spacing cannot be met is part of being exact: six
        // stops half a kilometre apart do not fit on a two-and-a-half
        // kilometre line, and neither search should pretend otherwise.
        if (truth === null) {
          expect(found).toBeNull();
          continue;
        }
        expect(found).not.toBeNull();
        expect(costOf(found!)).toBeCloseTo(truth.cost, 9);
        compared += 1;
      }
    }
    // Guard against the loop quietly comparing nothing.
    expect(compared).toBeGreaterThanOrEqual(7);
  });

  it("returns the stops in arc order, always", () => {
    const stops = bestStrokeWalk(nodes, 6, DRAWN, { minGapKm: 0.2 })!;
    const along = stops.map((id) => {
      const node = nodes.find((entry) => entry.id === id)!;
      return alongStrokeKm({ lat: node.lat, lng: node.lng }, DRAWN);
    });
    for (let i = 1; i < along.length; i += 1) {
      expect(along[i]).toBeGreaterThanOrEqual(along[i - 1]);
    }
  });

  it("honours a pinned tee and refuses one it was never given", () => {
    const stops = bestStrokeWalk(nodes, 5, DRAWN, {
      minGapKm: 0.2,
      startId: "s2",
      finishId: "s14",
    });
    expect(stops?.[0]).toBe("s2");
    expect(stops?.[stops.length - 1]).toBe("s14");
    expect(
      bestStrokeWalk(nodes, 5, DRAWN, { minGapKm: 0.2, startId: "nobody" }),
    ).toBeNull();
  });

  it("refuses rather than inventing when the spacing cannot be met", () => {
    // Six stops a kilometre apart do not fit on this line.
    expect(bestStrokeWalk(nodes, 6, DRAWN, { minGapKm: 5 })).toBeNull();
  });

  it("is deterministic — the same patch gives the same walk", () => {
    const once = bestStrokeWalk(nodes, 6, DRAWN, { minGapKm: 0.2 });
    const twice = bestStrokeWalk([...nodes].reverse(), 6, DRAWN, {
      minGapKm: 0.2,
    });
    expect(once).toEqual(twice);
  });
});

// ————————————————— the router —————————————————

/**
 * The patch that produced the report: a dense knot of pubs at one end of a
 * long drawn line, and a thinner scatter down the rest of it. Every greedy,
 * distance-minimising answer lives in the knot.
 */
const KNOT_AND_SCATTER: CandidateDossier[] = [
  // Ten pubs inside the first ~150m, all well rated.
  ...Array.from({ length: 10 }, (_, i) =>
    pub(
      `knot${i}`,
      51.5 + (i % 3) * 0.0004,
      -0.1 + Math.floor(i / 3) * 0.0006,
      4.6,
    ),
  ),
  // Eight more spread down the remaining line.
  ...Array.from({ length: 8 }, (_, i) =>
    pub(`far${i}`, 51.5 + (i % 2) * 0.0005, -0.1 + STEP * 0.5 * (i + 1), 4.2),
  ),
];

const DRAWN: StrokePoint[] = [
  { lat: 51.5, lng: -0.1 },
  { lat: 51.5, lng: -0.1 + STEP * 4 },
];

describe("buildRouteGraph, given a drawn walk", () => {
  const nodes = routableNodes(KNOT_AND_SCATTER);
  const candidates = KNOT_AND_SCATTER;

  it("offers only walks that span the line the host drew", () => {
    const graph = buildRouteGraph(candidates, {
      holes: 6,
      stroke: DRAWN,
      targetKm: strokeLengthKm(DRAWN),
    });

    expect(graph.routes.length).toBeGreaterThan(0);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const route of graph.routes) {
      const points = route.stops.map((id) => {
        const node = byId.get(id)!;
        return { lat: node.lat, lng: node.lng };
      });
      expect(strokeFit(points, DRAWN).coverage).toBeGreaterThanOrEqual(
        STROKE_COVERAGE_FLOOR,
      );
    }
  });

  it("walks the stops in the order the line was drawn", () => {
    const graph = buildRouteGraph(candidates, {
      holes: 6,
      stroke: DRAWN,
      targetKm: strokeLengthKm(DRAWN),
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const route of graph.routes) {
      const along = route.stops.map((id) => {
        const node = byId.get(id)!;
        return alongStrokeKm({ lat: node.lat, lng: node.lng }, DRAWN);
      });
      // Not strictly monotone — a menu is allowed a walk that steps back for
      // a better pub — but the drawn direction has to be the walk's direction.
      const backwards = along.filter(
        (at, i) => i > 0 && at < along[i - 1],
      ).length;
      expect(backwards).toBeLessThanOrEqual(1);
    }
  });

  it("still reaches the far end when the knot could fill every hole", () => {
    const graph = buildRouteGraph(candidates, {
      holes: 6,
      stroke: DRAWN,
      targetKm: strokeLengthKm(DRAWN),
    });
    for (const route of graph.routes) {
      expect(route.stops.some((id) => id.startsWith("far"))).toBe(true);
    }
  });

  it("leaves a patch with no stroke exactly as it was", () => {
    // The same candidates with nothing drawn: the clustered answer is a
    // perfectly good round, and nothing here should have made it illegal.
    const graph = buildRouteGraph(candidates, { holes: 6 });
    expect(graph.routes.length).toBeGreaterThan(0);
  });

  it("answers rather than refusing when the pubs really are all at one end", () => {
    // No scatter at all — every candidate is in the knot. The filter has to
    // fall back rather than hand back an empty menu.
    const knotOnly = KNOT_AND_SCATTER.filter((entry) =>
      entry.id.startsWith("knot"),
    );
    const graph = buildRouteGraph(knotOnly, {
      holes: 5,
      stroke: DRAWN,
      targetKm: strokeLengthKm(DRAWN),
    });
    expect(graph.routes.length).toBeGreaterThan(0);
    for (const route of graph.routes) expect(route.stops).toHaveLength(5);
  });
});
