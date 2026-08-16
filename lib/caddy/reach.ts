import { haversineKm } from "@/lib/geo";
import type { PatchPreview } from "@/lib/caddy/preflight";

/**
 * How far the round reaches, from two areas the host has typed.
 *
 * Pure, and separate from both the screen that shows it and the search that
 * resolves the names, because it is the one part of this that has to agree
 * with itself in two places: the ring drawn on the map and the sentence under
 * the form are the same fact, and the surest way to keep them saying the same
 * thing is for neither to do the arithmetic.
 */

export interface Reach {
  /** Where the ring is drawn from — the first area's centre. */
  centre: { lat: number; lng: number };
  /** Straight-line kilometres to the second area, or 0 for a single patch. */
  km: number;
  /** The walk is long enough that the host should hear about it first. */
  warn: boolean;
  /** What the lean search saw in the first area — the pre-flight's pins,
   * count and echo (`lib/caddy/preflight.ts`). Attached by the brief screen;
   * absent on a reach built from geometry alone. */
  preview?: PatchPreview | null;
}

/**
 * The centre of a handful of search results.
 *
 * Averaged rather than taking the first, because "Finsbury Park" returns pubs
 * *near* Finsbury Park and the first of them can sit at the edge of it. A mean
 * of the first few lands nearer the middle of the area a host has in mind, and
 * the ring is about an area rather than about a pub.
 */
export function centreOf(
  places: { lat: number | null; lng: number | null }[],
  take = 5,
): { lat: number; lng: number } | null {
  const placed = places
    .filter((p): p is { lat: number; lng: number } => p.lat != null && p.lng != null)
    .slice(0, take);
  if (placed.length === 0) return null;
  return {
    lat: placed.reduce((sum, p) => sum + p.lat, 0) / placed.length,
    lng: placed.reduce((sum, p) => sum + p.lng, 0) / placed.length,
  };
}

/**
 * The reach, or null when there is nothing to draw.
 *
 * A single area still gets a ring — sized to the patch the gather will
 * actually search rather than to nothing — because a host who has typed one
 * place should see where the caddy is about to look. The second area only
 * changes how far it goes.
 */
export function reachOf(
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | null,
  holes: number,
  singlePatchKm = 1.2,
): Reach | null {
  if (!from) return null;
  if (!to) return { centre: from, km: singlePatchKm, warn: false };
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
  return {
    centre: from,
    // A destination nearer than the patch radius is inside the patch already,
    // so the ring stays the patch rather than shrinking to something smaller
    // than the area actually being searched.
    km: Math.max(km, singlePatchKm),
    // The same threshold `stretchWarning` uses, so the ring turning amber and
    // the sentence appearing are one event rather than two that can disagree.
    warn: km / Math.max(holes - 1, 1) > 1.1,
  };
}
