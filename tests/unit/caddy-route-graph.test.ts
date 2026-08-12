import { describe, expect, it } from "vitest";

import type { CandidateDossier } from "@/lib/caddy/dossier";
import { CADDY_SYSTEM_TOOLS, patchBlock } from "@/lib/caddy/plan";
import {
  buildRouteGraph,
  routesBlock,
  targetKmFor,
  kindOf,
  nearestNeighbours,
  overlap,
  principalAxis,
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

describe("routesBlock", () => {
  const brief = {
    where: "Shoreditch",
    startVenueId: null,
    finishVenueId: null,
    holes: 4,
    vibe: "classic",
    particulars: [],
    note: "",
    stretch: 8,
  } as unknown as Parameters<typeof patchBlock>[1];

  it("is byte-stable, because it sits inside the cached prefix", () => {
    // The prefix carries the cache breakpoint. A block that differs by a byte
    // between turns misses cache on every one of them, which on a looped plan
    // is the difference between pennies and pounds.
    expect(patchBlock(LINE, brief)).toBe(patchBlock(LINE, brief));
  });

  it("names only candidate ids — it cannot invent a pub", () => {
    // Named pubs, so "the block contains no names" is a real assertion rather
    // than one the fixture satisfies by having ids for names.
    const named = ["The Bell", "Crown Tavern", "Nags Head", "Red Lion"].map(
      (name, index) => pub(`p${index}`, 0, index, name),
    );
    const block = routesBlock(buildRouteGraph(named, { holes: 4 }));
    // The dossier above carries what a pub is *like*; this block is only about
    // where things are, and a name here would be a name the model could copy.
    for (const candidate of named) expect(block).not.toContain(candidate.name);
    // And every stop it does name is an id that was handed in.
    const ids = new Set(named.map((c) => c.id));
    for (const stop of block.matchAll(/\bp\d+\b/g)) {
      expect(ids.has(stop[0])).toBe(true);
    }
  });

  it("reaches the prompt at all", () => {
    // The wiring itself. Built-and-never-called is the failure this catches.
    expect(patchBlock(LINE, brief)).toContain("<routes>");
    expect(patchBlock(LINE, brief)).toContain("<swaps>");
  });

  it("says nothing when there is nothing to route", () => {
    expect(routesBlock(buildRouteGraph([], { holes: 4 }))).toBe("");
  });
});

describe("targetKmFor", () => {
  it("reads the stated minimum leg as the walk the host wants", () => {
    // Eight minutes between four pubs is three legs of eight minutes at a
    // stroll, not the shortest line through four doors.
    expect(targetKmFor(8, 4)).toBeCloseTo((8 / 60) * 4.5 * 3, 5);
    // A one-hole round has no legs, and must not ask for a walk of zero.
    expect(targetKmFor(8, 1)).toBeGreaterThan(0);
  });
});

describe("the instructions and the map agree", () => {
  /**
   * The failure this exists to stop, which already happened once.
   *
   * The routes went into the prompt and the model went on searching anyway,
   * because the system prompt still described a search-and-refine workflow.
   * Data does not override instructions — it gives a model something else to
   * read while it does what it was told. The two halves have to be checked
   * against each other, because each is correct on its own.
   */
  const brief = {
    where: "Shoreditch",
    startVenueId: null,
    finishVenueId: null,
    holes: 4,
    vibe: "classic",
    particulars: [],
    note: "",
    stretch: 8,
  } as unknown as Parameters<typeof patchBlock>[1];

  it("points the caddy at sections the block actually emits", () => {
    const block = patchBlock(LINE, brief);
    for (const section of ["<routes>", "<swaps>"]) {
      expect(CADDY_SYSTEM_TOOLS, `the prompt never mentions ${section}`).toContain(
        section,
      );
      expect(block, `the block never emits ${section}`).toContain(section);
    }
  });

  it("tells the caddy to draft before it searches", () => {
    // The empty-board failure in one instruction: a model that searches for
    // ten minutes and never drafts leaves nothing to hand over when the clock
    // runs out. Drafting first means even a timeout is a card.
    const prompt = CADDY_SYSTEM_TOOLS;
    expect(prompt).toContain("PUT A ROUTE ON THE TABLE FIRST");
    // And the old instruction to re-measure everything is gone, since that is
    // what turned a plan into a dozen turns.
    expect(prompt).not.toContain("try_route before you hand anything over");
  });
});

describe("a night should go somewhere", () => {
  it("prefers a jaunt to a lap of the same block", () => {
    // The complaint this encodes: a route can hit the target distance exactly
    // and still spend the whole evening on two streets. Distance cannot see
    // it — only walk-against-progress can.
    //
    // The doubling-back route is built by hand rather than by the router,
    // because the router is the thing being tested and will not willingly
    // produce one. Same stops, same total walk, same target: the only thing
    // that differs is how far the night actually got.
    const jaunt = buildRouteGraph(LINE, { holes: 4, startId: "a", finishId: "f" })
      .routes[0];
    expect(jaunt.detour).toBeLessThan(1.6);

    const lap = { ...jaunt, detour: 4, progressKm: jaunt.totalKm / 4 };
    expect(scoreRoute(lap, jaunt.totalKm)).toBeGreaterThan(
      scoreRoute(jaunt, jaunt.totalKm),
    );
  });

  it("measures progress as the line from first stop to last", () => {
    const route = buildRouteGraph(LINE, { holes: 3, startId: "a", finishId: "c" })
      .routes[0];
    // Three stops on a straight line: the walk and the straight line agree, so
    // there is no detour to speak of.
    expect(route.progressKm).toBeCloseTo(route.totalKm, 5);
    expect(route.detour).toBeCloseTo(1, 2);
  });

  it("forgives a step back, and only a step", () => {
    // A crawl is not a commute. The odd doubling back for a good pub costs
    // nothing; a night of it does.
    const base = buildRouteGraph(LINE, { holes: 4, startId: "a", finishId: "f" })
      .routes[0];
    const slight = scoreRoute({ ...base, detour: 1.5 }, base.totalKm);
    const straight = scoreRoute({ ...base, detour: 1.0 }, base.totalKm);
    expect(slight).toBe(straight);
    expect(scoreRoute({ ...base, detour: 3 }, base.totalKm)).toBeGreaterThan(slight);
  });
});

describe("the menu answers different questions", () => {
  /** A patch where the objectives genuinely disagree: a cheap chain strip with
   * no garden, and a pricier row of one-offs that pour everything. */
  const PATCH = [
    { id: "c1", name: "Wetherspoon One", price: 1, rating: 3.4, beer: true, wine: false, cocktails: false, garden: false },
    { id: "c2", name: "Wetherspoon Two", price: 1, rating: 3.3, beer: true, wine: false, cocktails: false, garden: false },
    { id: "c3", name: "Wetherspoon Three", price: 1, rating: 3.5, beer: true, wine: false, cocktails: false, garden: false },
    { id: "g1", name: "The Bell", price: 3, rating: 4.7, beer: true, wine: true, cocktails: true, garden: true },
    { id: "g2", name: "Crown Tavern", price: 3, rating: 4.8, beer: true, wine: true, cocktails: true, garden: true },
    { id: "g3", name: "Nags Head", price: 3, rating: 4.6, beer: true, wine: true, cocktails: false, garden: true },
  ].map((row, index) => ({
    ...pub(row.id, index % 2, index, row.name),
    rating: row.rating,
    reviewCount: 400,
    priceLevel: row.price,
    facts: {
      outdoorSeating: row.garden,
      allowsDogs: null,
      servesBeer: row.beer,
      servesWine: row.wine,
      servesCocktails: row.cocktails,
      liveMusic: null,
      goodForWatchingSports: null,
      goodForGroups: null,
    },
  }));

  it("gives every route a distinct character", () => {
    const graph = buildRouteGraph(PATCH, { holes: 3, routes: 6 });
    const characters = graph.routes.map((route) => route.character);
    expect(new Set(characters).size).toBe(characters.length);
    // And none is left unnamed, which would mean an objective won nothing.
    for (const character of characters) expect(character.length).toBeGreaterThan(0);
  });

  it("finds a route that can pour more than beer", () => {
    // The house rule held by the router: a card cannot pour what its pubs do
    // not stock, so at least one route on the menu must be able to carry a
    // short and a glass of wine rather than nine pints.
    // Breadth across the card, not every pub pouring everything — a round
    // wants one hole on a short, not nine. So at least one route must cover
    // beer, wine and cocktails between its stops.
    const graph = buildRouteGraph(PATCH, { holes: 3, routes: 8 });
    const covers = (route: (typeof graph.routes)[number], fact: "servesBeer" | "servesWine" | "servesCocktails") =>
      route.stops.some((id) => PATCH.find((p) => p.id === id)?.facts[fact] === true);
    const wide = graph.routes.some(
      (route) =>
        covers(route, "servesBeer") &&
        covers(route, "servesWine") &&
        covers(route, "servesCocktails"),
    );
    expect(wide).toBe(true);
  });

  it("finds a cheaper route and a better-reviewed one, and they differ", () => {
    const graph = buildRouteGraph(PATCH, { holes: 3, routes: 8 });
    const priceOf = (route: (typeof graph.routes)[number]) =>
      route.stops.reduce(
        (sum, id) => sum + (PATCH.find((p) => p.id === id)?.priceLevel ?? 0),
        0,
      );
    const cheapest = Math.min(...graph.routes.map(priceOf));
    const dearest = Math.max(...graph.routes.map(priceOf));
    // If every route costs the same the menu is offering one thing many times.
    expect(dearest).toBeGreaterThan(cheapest);
  });
});

describe("snaking construction", () => {
  /** A blob of pubs with no obvious line through it — the shape that made
   * greedy wander, because every next pub is about as near as the last. */
  const BLOB = [
    pub("a", 0, 0), pub("b", 0, 1), pub("c", 1, 0), pub("d", 1, 1),
    pub("e", 2, 0), pub("f", 2, 1), pub("g", 3, 0), pub("h", 3, 1),
    pub("i", 4, 0), pub("j", 4, 1),
  ];

  it("finds the long axis of a patch", () => {
    // These are stacked in latitude, so the direction of travel is north,
    // not the east-west the raw degrees would suggest if longitude were not
    // scaled for latitude.
    const axis = principalAxis(routableNodes(BLOB));
    expect(Math.abs(axis.y)).toBeGreaterThan(Math.abs(axis.x));
  });

  it("builds a walk that gets somewhere rather than circling", () => {
    // The complaint, as a test. A menu over this blob must contain at least
    // one route that keeps moving — before the snake existed, every route
    // through it wandered and the objectives could only pick the least bad.
    const graph = buildRouteGraph(BLOB, { holes: 5, routes: 10 });
    const best = Math.min(...graph.routes.map((route) => route.detour));
    expect(best).toBeLessThan(1.5);
  });

  it("offers both a tight round and a strung-out one", () => {
    // Three drifts exist so the menu carries both and the brief can choose.
    // A menu where every route covers the same ground is one route.
    const graph = buildRouteGraph(BLOB, { holes: 5, routes: 10 });
    const progress = graph.routes.map((route) => route.progressKm);
    expect(Math.max(...progress)).toBeGreaterThan(Math.min(...progress) * 1.3);
  });

  it("never steps backwards along the direction of travel", () => {
    // The mechanism, asserted directly: a snaked route's stops must advance
    // monotonically along the axis. Doubling back is not penalised here, it is
    // unrepresentable — which is the difference between this and the scoring.
    const nodes = routableNodes(BLOB);
    const graph = buildRouteGraph(BLOB, { holes: 5, routes: 10 });
    const snaked = graph.routes.find((route) => route.detour < 1.3);
    expect(snaked).toBeDefined();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const origin = byId.get(snaked!.stops[0])!;
    const axis = principalAxis(nodes, origin, byId.get(snaked!.stops.at(-1)!));
    const scale = Math.cos(origin.lat * (Math.PI / 180));
    const at = (id: string) => {
      const node = byId.get(id)!;
      return (
        (node.lng - origin.lng) * scale * 111.32 * axis.x +
        (node.lat - origin.lat) * 111.32 * axis.y
      );
    };
    const positions = snaked!.stops.map(at);
    for (let i = 1; i < positions.length; i += 1) {
      // Allowing a small tolerance: 2-opt runs over the seed afterwards and
      // may shorten a leg in a way that nudges one stop, which is fine — what
      // must not happen is the walk turning round.
      expect(positions[i]).toBeGreaterThan(positions[i - 1] - 0.3);
    }
  });
});

describe("choosing the whole walk at once", () => {
  /** Two parallel rows. Stepping greedily forward can hop between them — each
   * hop is the cheapest step available at the time — and the result zigzags
   * across the axis while still never reversing along it. That is what read as
   * "loops back on itself" on a real map. */
  const TWO_ROWS = [
    pub("a0", 0, 0), pub("b0", 0, 1), pub("c0", 0, 2), pub("d0", 0, 3), pub("e0", 0, 4),
    pub("a1", 1, 0), pub("b1", 1, 1), pub("c1", 1, 2), pub("d1", 1, 3), pub("e1", 1, 4),
  ];

  it("keeps to one side instead of hopping across", () => {
    // Whole-route optimisation pays for lateral distance across the walk
    // rather than one step at a time, so it commits to a row. A per-step
    // chooser has no reason to.
    const graph = buildRouteGraph(TWO_ROWS, { holes: 5, routes: 10 });
    const straightest = graph.routes.reduce((best, route) =>
      route.detour < best.detour ? route : best,
    );
    const rows = new Set(straightest.stops.map((id) => id.slice(-1)));
    expect(rows.size).toBe(1);
  });

  it("is at least as good as the greedy snake it supersedes", () => {
    // The claim that makes the dynamic program worth its lines: for a forward
    // walk there is no better answer, so the menu's best detour cannot be
    // worse than what a per-step chooser managed.
    const graph = buildRouteGraph(TWO_ROWS, { holes: 5, routes: 10 });
    expect(Math.min(...graph.routes.map((route) => route.detour))).toBeLessThan(1.2);
  });

  it("still honours pinned tees", () => {
    const graph = buildRouteGraph(TWO_ROWS, {
      holes: 4,
      startId: "a0",
      finishId: "e1",
    });
    expect(graph.routes.length).toBeGreaterThan(0);
    for (const route of graph.routes) {
      expect(route.stops[0]).toBe("a0");
      expect(route.stops.at(-1)).toBe("e1");
      expect(route.stops).toHaveLength(4);
    }
  });

  it("does not repeat a stop", () => {
    const graph = buildRouteGraph(TWO_ROWS, { holes: 6, routes: 10 });
    for (const route of graph.routes) {
      expect(new Set(route.stops).size).toBe(route.stops.length);
    }
  });
});

describe("the caddy is told to name the course", () => {
  it("asks for a name, and stops short of handing over without one", () => {
    // A real card shipped called "The caddy's round" — the fallback, meaning
    // `name_course` was never called. The cause was in this prompt: rewriting
    // the workflow to lead with the route dropped naming from the stopping
    // criteria, so the model dressed nine holes, judged the card done, and
    // never named it. Nothing else in the pipeline can notice that.
    expect(CADDY_SYSTEM_TOOLS).toContain("NAME THE COURSE");
    expect(CADDY_SYSTEM_TOOLS).toContain("name_course");
    // Naming has to be in the list the caddy checks before it stops, not only
    // mentioned somewhere above it — that is exactly the difference that lost
    // it last time.
    const stopping = CADDY_SYSTEM_TOOLS.slice(
      CADDY_SYSTEM_TOOLS.indexOf("Stop when the card holds up"),
    );
    expect(stopping).toContain("a name on it");
  });

  it("tells it to make the name this round's rather than any round's", () => {
    expect(CADDY_SYSTEM_TOOLS).toMatch(/this round's rather than any round's/);
  });
});
