import { haversineKm } from "@/lib/geo";

/**
 * Barriers: the geography a straight line cannot see.
 *
 * A 200-metre leg across a river is a two-kilometre walk, and one such leg
 * makes a card a lie at the exact moment the group is stood on the wrong
 * bank. This module is the *mechanism*: a barrier is a polyline (a river, a
 * railway cutting) with gates (bridges) punched through it, and a leg that
 * crosses the line anywhere but a gate is a leg the router should not offer
 * while it has alternatives.
 *
 * **No data ships with the mechanism yet, on purpose.** Vendoring a river
 * from memory is exactly the class of confident-but-wrong data this product
 * exists to avoid; the polylines belong in `docs/`-style vendored files
 * extracted from OSM, reviewed against a map, one launch city at a time.
 * The mechanism is pure and proven against fixture geometry, so landing the
 * data is a data task, not a code one.
 */

export interface Point {
  lat: number;
  lng: number;
}

export interface Barrier {
  /** The line itself — a river's centreline, a railway's route. */
  line: Point[];
  /** Where crossing is fine: bridges, tunnels, level crossings. */
  gates: Point[];
  /** How close to a gate an intersection has to be to be excused. */
  gateKm: number;
}

/** Orientation of the ordered triple, on the local flat frame. */
function orient(a: Point, b: Point, c: Point, scale: number): number {
  const v = (b.lng - a.lng) * scale * (c.lat - b.lat) - (b.lat - a.lat) * ((c.lng - b.lng) * scale);
  return Math.abs(v) < 1e-12 ? 0 : v > 0 ? 1 : -1;
}

/** Where two segments cross, or null. Proper crossings only — a leg that
 * merely touches an endpoint is not a swim. */
function crossing(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): Point | null {
  const scale = Math.cos((a1.lat * Math.PI) / 180);
  const o1 = orient(a1, a2, b1, scale);
  const o2 = orient(a1, a2, b2, scale);
  const o3 = orient(b1, b2, a1, scale);
  const o4 = orient(b1, b2, a2, scale);
  if (o1 === o2 || o3 === o4 || o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) {
    return null;
  }
  // Line intersection in the flat frame, mapped back.
  const x1 = a1.lng * scale;
  const y1 = a1.lat;
  const x2 = a2.lng * scale;
  const y2 = a2.lat;
  const x3 = b1.lng * scale;
  const y3 = b1.lat;
  const x4 = b2.lng * scale;
  const y4 = b2.lat;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-15) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return {
    lat: y1 + t * (y2 - y1),
    lng: (x1 + t * (x2 - x1)) / scale,
  };
}

/**
 * Does this leg cross the barrier anywhere but a gate?
 */
export function legCrossesBarrier(
  from: Point,
  to: Point,
  barrier: Barrier,
): boolean {
  for (let i = 1; i < barrier.line.length; i += 1) {
    const hit = crossing(from, to, barrier.line[i - 1], barrier.line[i]);
    if (!hit) continue;
    const excused = barrier.gates.some(
      (gate) => haversineKm(hit.lat, hit.lng, gate.lat, gate.lng) <= barrier.gateKm,
    );
    if (!excused) return true;
  }
  return false;
}

/** Unexcused crossings along a whole walk. */
export function walkCrossings(
  stops: Point[],
  barriers: Barrier[],
): number {
  let count = 0;
  for (let i = 1; i < stops.length; i += 1) {
    for (const barrier of barriers) {
      if (legCrossesBarrier(stops[i - 1], stops[i], barrier)) count += 1;
    }
  }
  return count;
}
