import type { LatLng } from "@/lib/geo";

/**
 * The stroll: where the caddy's ball wanders while the plan is being written.
 *
 * This is ambience and says so — it measures nothing, it never accelerates,
 * and the stage list beside it stays the only claim the wait makes about
 * progress. A wandering ball that appeared to track a percentage would be the
 * lie the whole wait screen is designed to avoid.
 *
 * It is a pure function of a seed all the same, for two reasons: the same
 * session always wanders the same way (so a reconnect does not teleport the
 * ball), and a wander is testable rather than merely watchable.
 */

/** Deterministic 32-bit hash — the string seed becomes a number. */
function seedOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, and stable across engines — which is what makes
 * the walk reproducible in a test and in two browsers. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A walk over the candidate points: never twice to the same place in a row,
 * covering as much of the patch as the step count allows.
 *
 * Returns waypoints, not a timeline — how long the ball takes over each leg is
 * the animation's business, and keeping it out of here is what lets the same
 * walk render at one pace on a fast plan and another on a slow one.
 */
export function strollWaypoints(
  seed: string,
  points: readonly LatLng[],
  steps = 8,
): LatLng[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];

  const next = rng(seedOf(seed));
  const walk: LatLng[] = [];
  let at = Math.floor(next() * points.length) % points.length;
  walk.push(points[at]);

  for (let i = 1; i < steps; i++) {
    // Step to any point but the one we are standing on, so the ball always
    // visibly moves — a repeated waypoint reads as the animation having stalled.
    let candidate = Math.floor(next() * (points.length - 1));
    if (candidate >= at) candidate += 1;
    at = candidate % points.length;
    walk.push(points[at]);
  }
  return walk;
}
