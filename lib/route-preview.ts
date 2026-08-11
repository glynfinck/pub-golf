import { haversineKm } from "@/lib/geo";

/**
 * How to frame the route preview: what it covers, what shape the box is, and
 * how far along the walk has been drawn.
 *
 * The preview is a real map (`components/course/route-preview.tsx`) rather than
 * a diagram, so this module does not project anything — Google does that. What
 * is left is the part a map cannot decide for itself: which corner of the world
 * to fit, and how tall the frame should be.
 *
 * The height is the interesting half. A crawl up one street is long and thin; a
 * wander round a quarter is square. Forcing both into one fixed box wastes most
 * of it on the thin one and crops the square one, so the frame takes the
 * route's own aspect ratio, clamped at both ends so it is never a hairline or a
 * skyscraper.
 *
 * That calculation has one trap in it, which this branch has now walked into
 * three times: **a lat/lng grid is not isotropic.** A degree of longitude is a
 * degree of latitude times the cosine of where you are — about 62% of it in
 * London — so a route spanning equal *degrees* each way is markedly taller than
 * it is wide *on the ground*. Take the raw degree spans as an aspect ratio and
 * every east–west crawl gets a frame too tall for it.
 */

export interface PreviewStop {
  lat: number | null;
  lng: number | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** A hole that can actually be drawn: a position, and its number on the card. */
export interface PreviewHole {
  lat: number;
  lng: number;
  /** Counts from 1, and counts *every* hole — including any with no position,
   * which are absent from the map. A gap is honest; renumbering is not. */
  hole: number;
}

export interface PreviewFrame {
  /** What the map should fit, in the shape `defaultBounds` wants. */
  bounds: { north: number; south: number; east: number; west: number };
  /** width ÷ height, for the frame's `aspect-ratio`. */
  aspect: number;
  holes: PreviewHole[];
  /** The number of the final hole, so it can be marked as the finish. */
  lastHole: number;
}

/**
 * How wide the frame may get relative to its height — and note that both ends
 * are above 1, so the preview is *always* a landscape strip.
 *
 * That is a deliberate override of the route's own shape rather than a
 * reflection of it. A north–south crawl really is taller than it is wide, and
 * letting the frame say so would put a portrait map at the top of a phone
 * screen and push the card it previews below the fold. The preview's job is to
 * be glanced at on the way past; a tall one stops being a preview and starts
 * being the page. So a tall route is shown in a wide window, zoomed out enough
 * to hold it, which is also fine because this is not the map you navigate by —
 * tapping it opens the sheet that is.
 */
export const MIN_ASPECT = 1.6;
export const MAX_ASPECT = 2.6;

/**
 * A minimum span, in degrees of latitude, so a tight cluster is framed as a
 * neighbourhood rather than as a rooftop. Roughly 400 metres.
 *
 * Generous on purpose: a preview does not need detail, and a little too far
 * out reads as context while a little too close reads as a mistake.
 */
export const MIN_SPAN_DEG = 0.0036;

/**
 * Work out what the preview should show, or return null if there is nothing
 * worth showing.
 *
 * Holes without coordinates are skipped rather than guessed at — a pub added by
 * name has no position, and inventing one would draw a route that is not the
 * route. Fewer than two positioned holes is not a walk, and the preview renders
 * nothing at all rather than an empty frame.
 */
export function previewFrame(stops: PreviewStop[]): PreviewFrame | null {
  const holes: PreviewHole[] = [];
  stops.forEach((stop, index) => {
    if (stop.lat != null && stop.lng != null) {
      holes.push({ lat: stop.lat, lng: stop.lng, hole: index + 1 });
    }
  });
  if (holes.length < 2) return null;

  const lats = holes.map((hole) => hole.lat);
  const lngs = holes.map((hole) => hole.lng);
  let north = Math.max(...lats);
  let south = Math.min(...lats);
  let east = Math.max(...lngs);
  let west = Math.min(...lngs);

  // A pinch of room around a route that barely spans anything, so a tight
  // cluster is framed as a street rather than as a rooftop.
  const padTo = (low: number, high: number): [number, number] => {
    const short = MIN_SPAN_DEG - (high - low);
    if (short <= 0) return [low, high];
    const half = short / 2;
    return [low - half, high + half];
  };
  [south, north] = padTo(south, north);
  [west, east] = padTo(west, east);

  // Degrees into something proportional to metres before taking a ratio.
  const meanLat = (north + south) / 2;
  const squash = Math.cos((meanLat * Math.PI) / 180);
  const groundWidth = (east - west) * squash;
  const groundHeight = north - south;

  const aspect = Math.min(
    MAX_ASPECT,
    Math.max(MIN_ASPECT, groundWidth / (groundHeight || groundWidth || 1)),
  );

  return {
    bounds: { north, south, east, west },
    aspect,
    holes,
    lastHole: holes[holes.length - 1].hole,
  };
}

/**
 * How long the walk rests at each pub before setting off again, as a share of
 * the average leg.
 *
 * The pause is the whole reason this is paced rather than simply tweened. A
 * line that crawls at constant speed from one end of the card to the other
 * reads as a progress bar bent into the shape of a route; stopping at each pub
 * reads as a crawl, and — the part that actually matters — it lands every
 * numbered pin on its own beat instead of scattering nine of them past the eye
 * in a second and a half.
 */
export const DWELL_SHARE = 0.35;

/** The walk, drawn as far as it has got. */
export interface WalkedRoute {
  /** The line so far, ending part-way along a leg. One point until the walk
   * leaves the first pub, which draws as nothing — correct, there is no line
   * yet. */
  path: LatLng[];
  /** How many of `holes` have been reached, so their pins are on the map.
   * Always at least one: the walk starts *at* the first pub. */
  reached: number;
}

/**
 * Walk the route, and report how much of it has happened.
 *
 * Pure, and paced by ground distance rather than by hole count, for a reason
 * that is easy to miss: the preview is a Mercator map, and Mercator is
 * conformal — locally, screen distance is proportional to ground distance. So
 * pacing by metres is what makes the line move at a constant speed *on screen*.
 * Pace it by hole instead and a two-minute hop takes as long to draw as the
 * long trudge across the park, which looks like the animation stalling.
 *
 * `progress` runs 0..1 over the whole timeline — every leg, plus a rest at
 * every pub but the first and last.
 */
export function walkRoute(holes: PreviewHole[], progress: number): WalkedRoute {
  if (holes.length === 0) return { path: [], reached: 0 };
  const all = () => ({
    path: holes.map((hole) => ({ lat: hole.lat, lng: hole.lng })),
    reached: holes.length,
  });
  if (holes.length === 1 || progress >= 1) return all();

  const legs = holes
    .slice(1)
    .map((hole, index) =>
      haversineKm(holes[index].lat, holes[index].lng, hole.lat, hole.lng),
    );
  const walking = legs.reduce((total, leg) => total + leg, 0);
  // Every pub on one spot: there is no walk to pace, and dividing by the
  // distance would hand back NaN. Draw it and move on.
  if (walking <= 0) return all();

  const dwell = (walking / legs.length) * DWELL_SHARE;
  const timeline = walking + dwell * (legs.length - 1);
  let spent = Math.max(0, progress) * timeline;

  const path: LatLng[] = [{ lat: holes[0].lat, lng: holes[0].lng }];
  let reached = 1;

  for (let index = 0; index < legs.length; index += 1) {
    // Resting at the pub just reached — every one but the first, which is
    // where the walk begins rather than somewhere it arrives.
    if (index > 0) {
      if (spent < dwell) return { path, reached };
      spent -= dwell;
    }
    const leg = legs[index];
    if (spent < leg) {
      const share = spent / leg;
      // Straight-line interpolation: a leg is a few hundred metres, where the
      // difference between a rhumb line and a great circle is under a pixel.
      if (share > 0) {
        path.push({
          lat: holes[index].lat + (holes[index + 1].lat - holes[index].lat) * share,
          lng: holes[index].lng + (holes[index + 1].lng - holes[index].lng) * share,
        });
      }
      return { path, reached };
    }
    spent -= leg;
    path.push({ lat: holes[index + 1].lat, lng: holes[index + 1].lng });
    reached = index + 2;
  }
  return { path, reached };
}
