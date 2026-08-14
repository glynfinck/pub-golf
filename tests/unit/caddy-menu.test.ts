import { describe, expect, it } from "vitest";

import { readBrief } from "@/lib/caddy/brief";
import {
  buildCandidates,
  EMPTY_FACTS,
  type PubSource,
} from "@/lib/caddy/dossier";
import {
  chosenWalkFrom,
  leanDossier,
  menuOf,
  rerouteMenu,
} from "@/lib/caddy/menu";

// ————————————————— fixtures —————————————————

/** A strip of pubs up one street, ~200m apart, plus a couple off it. */
function source(n: number, over: Partial<PubSource> = {}): PubSource {
  return {
    venueId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `The Pub ${n}`,
    address: `${n} Example Street`,
    rating: 3.5 + (n % 3) * 0.5,
    reviewCount: 100 + n,
    lat: 51.5 + (n % 4) * 0.0006,
    lng: -0.07 - n * 0.0028,
    priceLevel: 2,
    facts: { ...EMPTY_FACTS },
    editorial: null,
    reviews: [],
    ...over,
  };
}

const CANDIDATES = buildCandidates(
  Array.from({ length: 16 }, (_, i) => source(i + 1)),
);

const BRIEF = readBrief({ where: "Example Town", holes: 6, stretch: 3 })!;

// ————————————————— the menu —————————————————

describe("menuOf", () => {
  const menu = menuOf(CANDIDATES, BRIEF);

  it("offers genuinely different complete walks", () => {
    expect(menu.routes.length).toBeGreaterThanOrEqual(2);
    for (const route of menu.routes) {
      expect(route.stops).toHaveLength(BRIEF.holes);
      expect(new Set(route.stops).size).toBe(BRIEF.holes);
      expect(route.character).not.toBe("");
      expect(route.totalKm).toBeGreaterThan(0);
    }
  });

  it("keeps the nodes lean: name, position, rating, and nothing paid", () => {
    expect(menu.nodes.length).toBe(CANDIDATES.length);
    for (const node of menu.nodes) {
      expect(Object.keys(node).sort()).toEqual(["id", "lat", "lng", "name", "rating"]);
    }
  });

  it("speaks only candidate ids", () => {
    const known = new Set(CANDIDATES.map((c) => c.id));
    for (const route of menu.routes) {
      for (const stop of route.stops) expect(known.has(stop)).toBe(true);
    }
  });
});

describe("rerouteMenu", () => {
  it("re-routes in the browser over lean nodes, dials applied", () => {
    const menu = menuOf(CANDIDATES, BRIEF);
    const rerouted = rerouteMenu(menu, { holes: 9, stretch: 5 });
    expect(rerouted.length).toBeGreaterThanOrEqual(1);
    for (const route of rerouted) {
      expect(route.stops).toHaveLength(9);
    }
  });

  it("round-trips: a lean dossier is a dossier the router accepts", () => {
    const menu = menuOf(CANDIDATES, BRIEF);
    const lean = leanDossier(menu.nodes);
    expect(lean).toHaveLength(menu.nodes.length);
    for (const candidate of lean) {
      expect(candidate.facts).toEqual(EMPTY_FACTS);
      expect(candidate.reviews).toEqual([]);
    }
  });
});

describe("chosenWalkFrom", () => {
  const menu = menuOf(CANDIDATES, BRIEF);
  const walk = menu.routes[0].stops;

  it("accepts a walk the menu offered", () => {
    expect(chosenWalkFrom(walk, CANDIDATES, BRIEF.holes)).toEqual(walk);
  });

  it("degrades everything else to null, never an error", () => {
    // Wrong length.
    expect(chosenWalkFrom(walk.slice(1), CANDIDATES, BRIEF.holes)).toBeNull();
    // An id nobody offered.
    expect(
      chosenWalkFrom([...walk.slice(0, -1), "p999"], CANDIDATES, BRIEF.holes),
    ).toBeNull();
    // A repeat.
    expect(
      chosenWalkFrom([...walk.slice(0, -1), walk[0]], CANDIDATES, BRIEF.holes),
    ).toBeNull();
    // Not even an array.
    expect(chosenWalkFrom("p1 > p2", CANDIDATES, BRIEF.holes)).toBeNull();
    expect(chosenWalkFrom([1, 2, 3, 4, 5, 6], CANDIDATES, BRIEF.holes)).toBeNull();
    expect(chosenWalkFrom(null, CANDIDATES, BRIEF.holes)).toBeNull();
  });
});
