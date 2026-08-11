import { describe, expect, it } from "vitest";

import type { CandidateDossier } from "@/lib/caddy/dossier";
import {
  buildRouteGraph,
  kindOf,
  nearestNeighbours,
  overlap,
  routableNodes,
  scoreRoute,
} from "@/lib/caddy/route-graph";

/**
 * The route graph is pure by design, so all of it is provable here — no stack,
 * no clock, no network. That is the point of putting the search in a function
 * rather than in a tool loop: the thing that used to cost a dozen model turns
 * and 29p is now something a test can hold still and check.
 */

/** A degree step small enough to keep the fixtures readable as a grid. It is
 * *not* a kilometre: 0.009° of latitude is about one, but the same step in
 * longitude at 51.5°N is roughly 0.6, so these tests assert shape and ordering
 * and compare legs against each other rather than against absolute figures. */
const STEP = 0.009;

function pub(id: string, row: number, col: number, name = id): CandidateDossier {
  return {
    id,
    venueId: `venue_${id}`,
    name,
    address: null,
    rating: 4,
    reviewCount: 100,
    lat: 51.5 + row * STEP,
    lng: -0.1 + col * STEP,
    priceLevel: 2,
    facts: {} as CandidateDossier["facts"],
    editorial: null,
    reviews: [],
  };
}

/** A straight line of evenly spaced pubs, so the shortest route through any
 * subset of them is knowable by eye. */
const LINE = ["a", "b", "c", "d", "e", "f"].map((id, index) => pub(id, 0, index));

describe("kindOf", () => {
  it("reads a chain's branches as one kind", () => {
    expect(kindOf("BrewDog Shoreditch")).toBe(kindOf("Brewdog — Camden"));
    expect(kindOf("The Old Bell")).not.toBe(kindOf("The Crown Tavern"));
  });
});

describe("routableNodes", () => {
  it("drops a pub with no position rather than defaulting it", () => {
    // Zero would put it in the Gulf of Guinea and make it the nearest thing to
    // nothing, which is worse than not routing it at all.
    const nowhere = { ...pub("x", 0, 0), lat: null, lng: null };
    const nodes = routableNodes([...LINE, nowhere]);
    expect(nodes).toHaveLength(LINE.length);
    expect(nodes.some((node) => node.id === "x")).toBe(false);
  });
});

describe("nearestNeighbours", () => {
  it("offers the closest others, nearest first", () => {
    const near = nearestNeighbours(routableNodes(LINE), 3);
    expect(near.a.map((n) => n.id)).toEqual(["b", "c", "d"]);
    expect(near.a[0].km).toBeLessThan(near.a[1].km);
    // Never itself — a swap suggestion of "this one" is not a suggestion.
    expect(near.c.some((n) => n.id === "c")).toBe(false);
  });
});

describe("overlap", () => {
  it("scores identical sets 1 and disjoint sets 0", () => {
    expect(overlap(["a", "b"], ["b", "a"])).toBe(1);
    expect(overlap(["a", "b"], ["c", "d"])).toBe(0);
    expect(overlap(["a", "b"], ["a", "c"])).toBeCloseTo(1 / 3);
  });
});

describe("buildRouteGraph", () => {
  it("honours a pinned start and finish", () => {
    const graph = buildRouteGraph(LINE, { holes: 4, startId: "a", finishId: "f" });
    expect(graph.routes.length).toBeGreaterThan(0);
    for (const route of graph.routes) {
      expect(route.stops).toHaveLength(4);
      expect(route.stops[0]).toBe("a");
      expect(route.stops[3]).toBe("f");
    }
  });

  it("never repeats a pub inside a route", () => {
    const graph = buildRouteGraph(LINE, { holes: 5 });
    for (const route of graph.routes) {
      expect(new Set(route.stops).size).toBe(route.stops.length);
    }
  });

  it("only ever returns candidate ids — it cannot invent a pub", () => {
    // The rule this whole feature is built around, asserted at the layer that
    // chooses. Every stop must be an id that came in.
    const known = new Set(LINE.map((candidate) => candidate.id));
    const graph = buildRouteGraph(LINE, { holes: 4 });
    for (const route of graph.routes) {
      for (const stop of route.stops) expect(known.has(stop)).toBe(true);
    }
    for (const [id, list] of Object.entries(graph.neighbours)) {
      expect(known.has(id)).toBe(true);
      for (const neighbour of list) expect(known.has(neighbour.id)).toBe(true);
    }
  });

  it("walks the line in order when the line is the answer", () => {
    // Six pubs strung out evenly: the shortest four-stop walk from a to d is
    // simply a-b-c-d, and a router that returns anything else is leaving a
    // crossing in.
    const graph = buildRouteGraph(LINE, { holes: 4, startId: "a", finishId: "d" });
    expect(graph.routes[0].stops).toEqual(["a", "b", "c", "d"]);
    // Three equal legs. The absolute figure is not asserted because these
    // fixtures step in *longitude*, which at 51.5°N is well under a kilometre
    // per 0.009° — the router was right about that and an earlier version of
    // this test was not.
    const [first, ...rest] = graph.routes[0].legs;
    for (const leg of rest) expect(leg.km).toBeCloseTo(first.km, 5);
    expect(graph.routes[0].totalKm).toBeCloseTo(first.km * 3, 5);
  });

  it("undoes a crossing that greedy would leave behind", () => {
    // Four corners of a rectangle, visited in order. Greedy from one corner can
    // leave a bow-tie across the diagonal; 2-opt must take it out.
    //
    // Asserted as a property rather than a distance: the corners are a grid of
    // degrees, and a degree of longitude at 51.5°N is about six-tenths of one
    // of latitude, so any figure derived from "the side length" is wrong before
    // it is written. A crossing-free path round a rectangle visits the corners
    // in perimeter order, either way round.
    const corners = [pub("a", 0, 0), pub("b", 0, 2), pub("c", 2, 2), pub("d", 2, 0)];
    const best = buildRouteGraph(corners, { holes: 4, startId: "a" }).routes[0];
    expect([
      ["a", "b", "c", "d"],
      ["a", "d", "c", "b"],
    ]).toContainEqual(best.stops);
  });

  it("hands back routes that are actually different from each other", () => {
    const spread = [
      ...LINE,
      pub("g", 3, 0),
      pub("h", 3, 1),
      pub("i", 3, 2),
      pub("j", 3, 3),
    ];
    const graph = buildRouteGraph(spread, { holes: 4, routes: 3 });
    for (let i = 0; i < graph.routes.length; i += 1) {
      for (let j = i + 1; j < graph.routes.length; j += 1) {
        expect(
          overlap(graph.routes[i].stops, graph.routes[j].stops),
          `routes ${i} and ${j} are the same route twice`,
        ).toBeLessThanOrEqual(0.7);
      }
    }
  });

  it("gives every route its own character", () => {
    const graph = buildRouteGraph(
      [...LINE, pub("g", 3, 0), pub("h", 3, 2), pub("i", 1, 4)],
      { holes: 4, routes: 3 },
    );
    const characters = graph.routes.map((route) => route.character);
    expect(new Set(characters).size).toBe(characters.length);
  });

  it("returns no route when there is nothing to walk between", () => {
    expect(buildRouteGraph([pub("a", 0, 0)], { holes: 4 }).routes).toEqual([]);
    expect(buildRouteGraph([], { holes: 4 }).routes).toEqual([]);
  });

  it("never asks for more stops than there are pubs", () => {
    const graph = buildRouteGraph(LINE.slice(0, 3), { holes: 9 });
    for (const route of graph.routes) {
      expect(route.stops.length).toBeLessThanOrEqual(3);
    }
  });
});

describe("scoreRoute", () => {
  it("prefers the walk the host asked for over the shortest one", () => {
    // The term a distance-minimising solver gets wrong. A host who asked for
    // four kilometres wants four, not nine pubs on one street.
    // Both walks are made of equal, comfortable legs, so the only thing
    // separating them is length against the target. An earlier version of this
    // test compared a gentle stroll with a route carrying one 2.5km trek and
    // was surprised the trek scored worse — which was the scorer being right.
    const short = buildRouteGraph(LINE, { holes: 3, startId: "a", finishId: "c" })
      .routes[0];
    const long = buildRouteGraph(LINE, { holes: 5, startId: "a", finishId: "e" })
      .routes[0];
    expect(long.totalKm).toBeGreaterThan(short.totalKm);
    expect(long.worstLegKm).toBeCloseTo(short.worstLegKm, 5);
    expect(scoreRoute(long, long.totalKm)).toBeLessThan(scoreRoute(short, long.totalKm));
  });

  it("punishes one brutal leg the average would hide", () => {
    const easy = buildRouteGraph(LINE, { holes: 3, startId: "a", finishId: "c" })
      .routes[0];
    const trek = buildRouteGraph([pub("a", 0, 0), pub("b", 0, 1), pub("z", 0, 9)], {
      holes: 3,
      startId: "a",
      finishId: "z",
    }).routes[0];
    expect(trek.worstLegKm).toBeGreaterThan(easy.worstLegKm);
    // Same target for both, so the difference is the leg rather than the length.
    expect(scoreRoute(trek, trek.totalKm)).toBeGreaterThan(
      scoreRoute(easy, easy.totalKm),
    );
  });

  it("counts a row of the same chain as worse than a mixed round", () => {
    const chain = ["a", "b", "c", "d"].map((id, index) =>
      pub(id, 0, index, "BrewDog Somewhere"),
    );
    const mixed = ["a", "b", "c", "d"].map((id, index) =>
      pub(id, 0, index, ["The Bell", "Crown Tavern", "Nags Head", "Red Lion"][index]),
    );
    const chainRoute = buildRouteGraph(chain, { holes: 4 }).routes[0];
    const mixedRoute = buildRouteGraph(mixed, { holes: 4 }).routes[0];
    expect(chainRoute.variety).toBe(1);
    expect(mixedRoute.variety).toBe(4);
    expect(scoreRoute(chainRoute, null)).toBeGreaterThan(scoreRoute(mixedRoute, null));
  });
});
