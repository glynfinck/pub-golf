import { describe, expect, it } from "vitest";

import type { CandidateDossier } from "@/lib/caddy/dossier";
import { buildRouteGraph } from "@/lib/caddy/route-graph";
import { forwardOrder } from "@/lib/caddy/route";
import { haversineKm } from "@/lib/geo";

/**
 * The rounds that came back wrong, as tests.
 *
 * Every routing failure on this branch was found by planning a real course on
 * preview, looking at the map, and describing what was off — which costs a
 * re-design, a few minutes and somebody's patience each time, and produces one
 * data point. That was the wrong loop: none of it needed a language model or a
 * network. The candidates are coordinates and the route is a pure function of
 * them, so the whole failure reproduces here in milliseconds.
 *
 * These fixtures are the actual pubs from the actual bad cards, with their
 * real positions. Each `describe` is a round a host asked for and did not get.
 */

function pub(
  id: string,
  name: string,
  lat: number,
  lng: number,
): CandidateDossier {
  return {
    id,
    venueId: `venue_${id}`,
    name,
    address: null,
    rating: 4.2,
    reviewCount: 300,
    lat,
    lng,
    priceLevel: 2,
    facts: {} as CandidateDossier["facts"],
    editorial: null,
    reviews: [],
  };
}

/**
 * Marylebone to Covent Garden, as the corridor actually gathers it.
 *
 * Real pubs, real positions: a cluster around Marylebone in the west, a
 * scatter through Fitzrovia and Soho in the middle, and a cluster around
 * Covent Garden in the east. Marylebone is around -0.155 and Covent Garden
 * around -0.124, so "did the round get there" is a question about longitude.
 */
const MARYLEBONE_TO_COVENT_GARDEN: CandidateDossier[] = [
  // Marylebone, and west of it — the pubs the failing rounds kept choosing.
  pub("p1", "Lord Wargrave", 51.51812, -0.16578),
  pub("p2", "The Royal Oak", 51.52006, -0.16237),
  pub("p3", "The Duke of Wellington", 51.51934, -0.16146),
  pub("p4", "The Barley Mow", 51.5197, -0.15565),
  pub("p5", "The Hart", 51.51842, -0.15479),
  pub("p6", "The Devonshire Arms", 51.5162, -0.15216),
  pub("p7", "Angel In The Fields", 51.51806, -0.15139),
  pub("p8", "The Duchess", 51.51475, -0.1514),
  pub("p9", "Lamb & Flag", 51.51495, -0.1504),
  // Fitzrovia and Oxford Circus — the middle of the corridor.
  pub("p10", "The Wigmore", 51.5175, -0.14328),
  pub("p11", "The George", 51.51765, -0.14184),
  pub("p12", "The Social", 51.51735, -0.14073),
  pub("p13", "The Oxford Market", 51.51644, -0.14047),
  pub("p14", "Mr Fogg's Botanical", 51.51887, -0.13662),
  // Soho, still short of the finish.
  pub("p15", "The Dog and Duck", 51.5139, -0.13228),
  pub("p16", "The Coach & Horses", 51.5128, -0.13215),
  pub("p17", "The French House", 51.5131, -0.13166),
  // Covent Garden — where the host asked to end up.
  pub("p18", "The Harp", 51.5093, -0.12631),
  pub("p19", "The Lamb & Flag CG", 51.5121, -0.12456),
  pub("p20", "The Nell Gwynne", 51.5107, -0.12318),
  pub("p21", "The Cross Keys", 51.5124, -0.12379),
];

const MARYLEBONE = { lat: 51.5175, lng: -0.1535 };
const COVENT_GARDEN = { lat: 51.5115, lng: -0.1245 };

/** Everything east of this is Covent Garden rather than Soho. */
const COVENT_GARDEN_EDGE = -0.128;

describe("Marylebone to Covent Garden", () => {
  it("finishes in Covent Garden, not wherever the cloud is widest", () => {
    // The failure, exactly: a round asked to finish in Covent Garden walked
    // Marylebone *westwards* to -0.166. With no pinned venues the axis is a
    // line and nothing said which way to travel along it, so "the two
    // furthest-apart candidates" chose a direction and chose wrong.
    const graph = buildRouteGraph(MARYLEBONE_TO_COVENT_GARDEN, {
      holes: 9,
      aimFrom: MARYLEBONE,
      aimTo: COVENT_GARDEN,
      targetKm: 2.3,
      routes: 8,
    });

    expect(graph.routes.length).toBeGreaterThan(0);
    for (const route of graph.routes) {
      const last = MARYLEBONE_TO_COVENT_GARDEN.find(
        (candidate) => candidate.id === route.stops.at(-1),
      )!;
      expect(
        last.lng!,
        `${route.character} finishes at ${last.name} (${last.lng})`,
      ).toBeGreaterThan(COVENT_GARDEN_EDGE);
    }
  });

  it("starts in Marylebone", () => {
    const graph = buildRouteGraph(MARYLEBONE_TO_COVENT_GARDEN, {
      holes: 9,
      aimFrom: MARYLEBONE,
      aimTo: COVENT_GARDEN,
      targetKm: 2.3,
      routes: 8,
    });
    for (const route of graph.routes) {
      const first = MARYLEBONE_TO_COVENT_GARDEN.find(
        (candidate) => candidate.id === route.stops[0],
      )!;
      expect(haversineKm(first.lat!, first.lng!, MARYLEBONE.lat, MARYLEBONE.lng))
        .toBeLessThan(0.7);
    }
  });

  it("travels east the whole way rather than doubling back", () => {
    // The other failure this branch chased: a card that went forward, back,
    // forward, back. With the ends aimed, every stop should be further east
    // than the one before.
    const graph = buildRouteGraph(MARYLEBONE_TO_COVENT_GARDEN, {
      holes: 9,
      aimFrom: MARYLEBONE,
      aimTo: COVENT_GARDEN,
      targetKm: 2.3,
      routes: 8,
    });
    const stops = graph.routes[0].stops.map(
      (id) => MARYLEBONE_TO_COVENT_GARDEN.find((c) => c.id === id)!,
    );
    const walked = forwardOrder(
      stops.map((s) => ({ venue_id: s.venueId, lat: s.lat, lng: s.lng })),
      { first: true, last: true },
    );
    for (let i = 1; i < walked.length; i += 1) {
      expect(
        walked[i].lng!,
        `hole ${i + 1} is west of hole ${i}`,
      ).toBeGreaterThanOrEqual(walked[i - 1].lng! - 0.002);
    }
  });

  it("actually covers the ground between the two areas", () => {
    // A round that starts and ends right can still skip the middle. The walk
    // should be most of the straight-line distance, not a hop.
    const apart = haversineKm(
      MARYLEBONE.lat,
      MARYLEBONE.lng,
      COVENT_GARDEN.lat,
      COVENT_GARDEN.lng,
    );
    const graph = buildRouteGraph(MARYLEBONE_TO_COVENT_GARDEN, {
      holes: 9,
      aimFrom: MARYLEBONE,
      aimTo: COVENT_GARDEN,
      targetKm: apart * 1.15,
      routes: 8,
    });
    expect(graph.routes[0].progressKm).toBeGreaterThan(apart * 0.8);
  });

  it("leaves a single-patch round alone", () => {
    // No destination named: nothing aims the walk and it behaves exactly as it
    // did before, which is what stops this being a change to every round.
    const graph = buildRouteGraph(MARYLEBONE_TO_COVENT_GARDEN, {
      holes: 6,
      routes: 6,
    });
    expect(graph.routes.length).toBeGreaterThan(0);
    for (const route of graph.routes) expect(route.stops).toHaveLength(6);
  });

  it("lets a pinned venue beat an area", () => {
    // A host who dropped a pin means it. The area only decides an end when
    // nothing was pinned there.
    const graph = buildRouteGraph(MARYLEBONE_TO_COVENT_GARDEN, {
      holes: 5,
      startId: "p15",
      aimFrom: MARYLEBONE,
      aimTo: COVENT_GARDEN,
      routes: 4,
    });
    for (const route of graph.routes) expect(route.stops[0]).toBe("p15");
  });
});

/**
 * The Shoreditch round that doubled back, at its real coordinates.
 *
 * Nine good pubs walked at +0.00, -0.17, +0.24, -0.21, -0.20, +0.25, +0.28,
 * +0.69, +0.97 along their own line: 2.47km of walking to cover 0.97km of
 * ground. Kept because it is the case `forwardOrder` exists for, and because
 * a fixture from a real card is worth more than one drawn on graph paper.
 */
const SHOREDITCH = [
  pub("s1", "The Old Blue Last", 51.52441, -0.08013),
  pub("s2", "The Shoreditch Arms", 51.52685, -0.07822),
  pub("s3", "Queen's Head", 51.52274, -0.07801),
  pub("s4", "The Blues Kitchen", 51.52655, -0.08018),
  pub("s5", "The Bricklayers Arms", 51.52616, -0.0811),
  pub("s6", "The Crown and Shuttle", 51.5225, -0.07818),
  pub("s7", "The Edge Bar", 51.52238, -0.07778),
  pub("s8", "The Ten Bells", 51.51935, -0.07429),
  pub("s9", "The Culpeper", 51.51692, -0.07302),
];

describe("the Shoreditch round that doubled back", () => {
  it("walks it as one continuous line", () => {
    const walked = forwardOrder(
      SHOREDITCH.map((s) => ({ venue_id: s.venueId, lat: s.lat, lng: s.lng })),
    );
    // Every step must make progress along the line from first stop to last.
    const first = walked[0];
    const last = walked[walked.length - 1];
    const scale = Math.cos((first.lat! * Math.PI) / 180);
    const ax = (last.lng! - first.lng!) * scale;
    const ay = last.lat! - first.lat!;
    const len = Math.hypot(ax, ay);
    const along = walked.map(
      (s) => (((s.lng! - first.lng!) * scale * ax + (s.lat! - first.lat!) * ay) / len),
    );
    for (let i = 1; i < along.length; i += 1) {
      expect(along[i], `hole ${i + 1} steps back`).toBeGreaterThanOrEqual(
        along[i - 1] - 1e-9,
      );
    }
  });

  it("spends less walk per kilometre of ground than the card that shipped", () => {
    // The shipped card was 2.47km of walking for 0.97km of progress — a detour
    // of 2.55. Anything near that is the bug returning.
    const graph = buildRouteGraph(SHOREDITCH, { holes: 9, routes: 6 });
    expect(Math.min(...graph.routes.map((r) => r.detour))).toBeLessThan(1.8);
  });
});
