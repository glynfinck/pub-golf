import { haversineKm } from "@/lib/geo";

/**
 * The stroke: draw the walk, and the circles come out from the line.
 *
 * Naming an area cannot say *along the river*, *round the park*, or *the L
 * through the market* — the corridor is a straight line between two names.
 * The stroke is the general case, and everything else on the map is its
 * degenerate form: the ring is a buffered point, the A→B capsule a buffered
 * segment, the stroke a buffered polyline. One geometry underneath, so via
 * points never need to exist — a via is a bend.
 *
 * **A line, not a paint.** The width is a dial applied after the stroke, a
 * line can be simplified, measured and projected onto — and the router needs
 * all three. Everything here is pure: points in, geometry out, provable in
 * the unit tier.
 *
 * Coordinates are lat/lng throughout, worked on a local flat projection
 * (longitude scaled by cos φ) — the same arrangement `principalAxis` uses,
 * for the same reason: a degree of longitude is not a degree of latitude.
 */

export interface StrokePoint {
  lat: number;
  lng: number;
}

/** The most vertices a stroke may carry over the wire. A finger's night out
 * simplifies to well under this; anything more is not a stroke. */
export const STROKE_MAX_POINTS = 20;

/** The most gather circles a stroke may spend. Each is a Nearby search, so
 * past this the sampling widens rather than the bill growing. */
export const STROKE_MAX_CIRCLES = 12;

/** Local flat projection around a latitude: km per degree. */
function frame(lat: number): { kx: number; ky: number } {
  return { kx: 111.32 * Math.cos((lat * Math.PI) / 180), ky: 111.32 };
}

function perpendicularKm(
  p: StrokePoint,
  a: StrokePoint,
  b: StrokePoint,
): { km: number; t: number } {
  const { kx, ky } = frame(a.lat);
  const ax = 0;
  const ay = 0;
  const bx = (b.lng - a.lng) * kx;
  const by = (b.lat - a.lat) * ky;
  const px = (p.lng - a.lng) * kx;
  const py = (p.lat - a.lat) * ky;
  const len2 = bx * bx + by * by;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const cx = ax + t * bx;
  const cy = ay + t * by;
  return { km: Math.hypot(px - cx, py - cy), t };
}

/**
 * Ramer–Douglas–Peucker, over the earth's own metres.
 *
 * The finger's wobble is noise, not intent: a stroke drawn at city zoom
 * arrives as hundreds of points and means five to fifteen. The tolerance is
 * the caller's — a third of the buffer width is the honest choice, because
 * detail finer than the swath cannot change which pubs are in it.
 */
export function simplifyStroke(
  points: StrokePoint[],
  toleranceKm: number,
): StrokePoint[] {
  if (points.length < 3) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    let worst = 0;
    let at = -1;
    for (let i = from + 1; i < to; i += 1) {
      const { km } = perpendicularKm(points[i], points[from], points[to]);
      if (km > worst) {
        worst = km;
        at = i;
      }
    }
    if (worst > toleranceKm && at > 0) {
      keep[at] = true;
      stack.push([from, at], [at, to]);
    }
  }
  const kept = points.filter((_, i) => keep[i]);
  // The wire bound holds whatever the tolerance was asked for: a stroke that
  // still carries too much detail loses its least significant vertices by
  // re-simplifying coarser, never by truncation — cutting the tail off a
  // walk is not a simplification of it.
  return kept.length <= STROKE_MAX_POINTS
    ? kept
    : simplifyStroke(kept, toleranceKm * 1.6);
}

/** The stroke's length as walked, in kilometres — the honest `reachKm`,
 * because the host has already drawn around the river. */
export function strokeLengthKm(points: StrokePoint[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i += 1) {
    km += haversineKm(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng,
    );
  }
  return km;
}

/**
 * Gather circles sampled by arc length down the line: ends included, spaced
 * to overlap at the given radius, capped by widening the spacing rather
 * than shortening the coverage.
 */
export function strokeCircles(
  points: StrokePoint[],
  radiusKm: number,
): StrokePoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];
  const length = strokeLengthKm(points);
  const overlap = radiusKm * 0.9;
  const wanted = Math.min(
    STROKE_MAX_CIRCLES,
    Math.max(2, Math.ceil(length / overlap) + 1),
  );
  const step = length / (wanted - 1);
  const centres: StrokePoint[] = [points[0]];
  let walked = 0;
  let next = step;
  for (let i = 1; i < points.length; i += 1) {
    let a = points[i - 1];
    const b = points[i];
    let seg = haversineKm(a.lat, a.lng, b.lat, b.lng);
    while (walked + seg >= next - 1e-9 && centres.length < wanted - 1) {
      const need = next - walked;
      const f = seg === 0 ? 0 : need / seg;
      const at = {
        lat: a.lat + (b.lat - a.lat) * f,
        lng: a.lng + (b.lng - a.lng) * f,
      };
      centres.push(at);
      walked += need;
      seg -= need;
      a = at;
      next += step;
    }
    walked += seg;
  }
  centres.push(points[points.length - 1]);
  return centres;
}

/** Distance from a point to the stroke, in kilometres — the membership test
 * behind "pins light and drop as the width moves". */
export function distanceToStrokeKm(
  p: StrokePoint,
  points: StrokePoint[],
): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) {
    return haversineKm(p.lat, p.lng, points[0].lat, points[0].lng);
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i += 1) {
    const { km } = perpendicularKm(p, points[i - 1], points[i]);
    best = Math.min(best, km);
  }
  return best;
}

/**
 * How far along the stroke a point sits, in kilometres of arc — the axis,
 * stated by the host rather than guessed from the candidate cloud.
 *
 * The forward walk's projection: `principalAxis` finds a straight line to
 * be monotone along, and a drawn stroke *is* that line, curved. A pub
 * projects to its nearest segment, and its position is the arc length up to
 * that projection — so "forward" means "the way the stroke was drawn", and
 * doubling back stays unrepresentable along a bend.
 */
export function alongStrokeKm(p: StrokePoint, points: StrokePoint[]): number {
  if (points.length < 2) return 0;
  let best = Number.POSITIVE_INFINITY;
  let at = 0;
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const seg = haversineKm(a.lat, a.lng, b.lat, b.lng);
    const { km, t } = perpendicularKm(p, a, b);
    if (km < best) {
      best = km;
      at = walked + seg * t;
    }
    walked += seg;
  }
  return at;
}

/**
 * How well a walk actually follows the line it was drawn on.
 *
 * `alongStrokeKm` gives the router an *order* to be monotone in, and that was
 * taken for the whole of following a stroke. It is not: a walk can be
 * perfectly monotone and still sit in the first two streets of a line drawn
 * across town, because "never goes backwards" says nothing about how far
 * forwards it ever gets. Coverage is the missing half, and it is the half the
 * host is actually looking at — they drew a route and want the card walked
 * down it.
 *
 * All three numbers are read against the stroke's own arc length, so they mean
 * the same thing on a two-kilometre line and a ten-kilometre one:
 *
 *   `coverage` — the share of the line between the first stop and the last.
 *   `backtrackKm` — how much of the walk is spent going back the way the
 *     stroke came, which is what makes a snake read as a scribble.
 *   `worstGapKm` — the longest stretch of drawn line with no stop on it, the
 *     ends included, so a walk that ignores the last third says so.
 */
export interface StrokeFit {
  coverage: number;
  backtrackKm: number;
  worstGapKm: number;
}

export function strokeFit(
  points: StrokePoint[],
  stroke: StrokePoint[],
): StrokeFit {
  const length = strokeLengthKm(stroke);
  if (points.length === 0 || stroke.length < 2 || length <= 0) {
    return { coverage: 0, backtrackKm: 0, worstGapKm: length };
  }
  const along = points.map((point) => alongStrokeKm(point, stroke));

  // Walking order, so this counts the walk's own doubling back rather than
  // the set's spread — the same stops in a different order are a different
  // answer to the question "does this follow the line?".
  let backtrackKm = 0;
  for (let i = 1; i < along.length; i += 1) {
    const step = along[i] - along[i - 1];
    if (step < 0) backtrackKm -= step;
  }

  const sorted = [...along].sort((a, b) => a - b);
  // The head of the line is a gap like any other: a walk starting a
  // kilometre in has left a kilometre of drawn line unvisited, and saying so
  // is the difference between "covers the line" and "covers some line".
  let worstGapKm = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    worstGapKm = Math.max(worstGapKm, sorted[i] - sorted[i - 1]);
  }
  worstGapKm = Math.max(worstGapKm, length - sorted[sorted.length - 1]);

  const spanKm = sorted[sorted.length - 1] - sorted[0];
  return {
    coverage: Math.max(0, Math.min(1, spanKm / length)),
    backtrackKm,
    worstGapKm,
  };
}

/** A stroke off the wire: bounded, finite, and never trusted. Null for
 * anything that is not a plausible drawn line. */
export function readStroke(value: unknown): StrokePoint[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  if (value.length > STROKE_MAX_POINTS) return null;
  const points: StrokePoint[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { lat, lng } = entry as { lat?: unknown; lng?: unknown };
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    points.push({ lat, lng });
  }
  // A stroke longer than a long day's walk is a typo or a joke — same rule
  // `readBrief` keeps for `reachKm`.
  return strokeLengthKm(points) <= 40 ? points : null;
}
