/**
 * The route as a shape, projected for drawing.
 *
 * A card is a list until you see it on a map, and going to the map is a sheet
 * away — so the drafting table carries a small always-visible drawing of the
 * walk instead. This module is the arithmetic behind it: latitude and longitude
 * in, coordinates in a viewBox out. Pure, because that is the half worth
 * testing; the component that draws it is a few lines of SVG.
 *
 * Deliberately not a map. No tiles, no basemap, no browser key, nothing loaded
 * from Google — which also means it can never disagree with Google's terms
 * about where Places results may be drawn, since it draws no Places results.
 * It shows only the pubs the host has actually chosen, numbered in walking
 * order. What it gives up is streets; what it answers is "does this look like a
 * walk or a scatter", which is the question the list cannot answer.
 *
 * Two pieces of arithmetic earn their place:
 *
 * **Longitude has to be squashed.** A degree of longitude is a degree of
 * latitude times the cosine of where you are — about 62% of it in London. Plot
 * raw lng against lat and every route comes out stretched east–west, so a
 * straight walk up a street reads as a diagonal. The projection corrects for it
 * at the route's own mean latitude, which is exact enough over the couple of
 * kilometres a crawl covers.
 *
 * **The frame follows the route.** A walk up one street is long and thin; a
 * wander round a quarter is square. Fitting both into a fixed rectangle wastes
 * most of it and shrinks the pins, so the viewBox takes the route's own aspect
 * ratio — clamped, so a perfectly straight crawl does not become a hairline and
 * a north–south one does not become a skyscraper.
 */

export interface PreviewStop {
  lat: number | null;
  lng: number | null;
}

export interface PreviewPoint {
  x: number;
  y: number;
  /** Where this stop sits in the card, so the pin can be numbered. Counts from
   * 1 and counts *every* hole, including any the projection had to skip. */
  hole: number;
}

export interface RoutePreview {
  /** viewBox width. Fixed — the height is what varies. */
  width: number;
  height: number;
  points: PreviewPoint[];
}

/** The viewBox is unitless; the component scales it to whatever width it has.
 * A hundred is a round number to reason about padding in. */
export const PREVIEW_WIDTH = 100;

/** Room for a pin at the edge of the frame, so a hole on the boundary is not
 * clipped in half. Roughly the pin radius the component draws. */
export const PREVIEW_PADDING = 9;

/** How tall the frame may get relative to its width. A wide route is capped so
 * a dead-straight east–west crawl keeps enough height to read as a line rather
 * than a rule; a tall one is capped so the preview never dominates the screen
 * it is a preview on. */
export const MIN_ASPECT = 0.42;
export const MAX_ASPECT = 1.25;

/**
 * Project a card into a frame, or return null if there is nothing to draw.
 *
 * Stops without coordinates are skipped rather than guessed at — a pub added by
 * name has no position, and inventing one would draw a route that is not the
 * route. Their hole numbers are simply absent from the drawing, which is honest
 * and reads as a gap rather than as a lie.
 */
export function projectRoute(stops: PreviewStop[]): RoutePreview | null {
  const placed = stops
    .map((stop, index) => ({ stop, hole: index + 1 }))
    .filter(
      (entry): entry is { stop: { lat: number; lng: number }; hole: number } =>
        entry.stop.lat != null && entry.stop.lng != null,
    );
  // One pin is not a route. Two is the shortest thing worth drawing.
  if (placed.length < 2) return null;

  const lats = placed.map((entry) => entry.stop.lat);
  const lngs = placed.map((entry) => entry.stop.lng);
  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  // The squash. cos of the mean latitude is exact enough across a crawl.
  const squash = Math.cos((meanLat * Math.PI) / 180);

  const xs = lngs.map((lng) => lng * squash);
  const ys = lats;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  // Every pub on one spot, or a perfectly straight line in one axis. Guarded
  // rather than divided by: the result is a legible line, not a NaN.
  const safeSpanX = spanX || spanY || 1;
  const safeSpanY = spanY || spanX || 1;

  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, safeSpanY / safeSpanX));
  const height = PREVIEW_WIDTH * aspect;

  const innerW = PREVIEW_WIDTH - PREVIEW_PADDING * 2;
  const innerH = height - PREVIEW_PADDING * 2;
  // One scale for both axes, so the shape is never distorted to fill the frame
  // — a route that doubles back must look like it doubles back.
  const scale = Math.min(innerW / safeSpanX, innerH / safeSpanY);
  // Whatever the single scale did not use becomes even margin, so the walk sits
  // centred rather than jammed against the padding.
  const usedW = safeSpanX * scale;
  const usedH = safeSpanY * scale;
  const offsetX = (PREVIEW_WIDTH - usedW) / 2;
  const offsetY = (height - usedH) / 2;

  const points = placed.map((entry, i) => ({
    x: offsetX + (xs[i] - minX) * scale,
    // Screen y grows downward and latitude grows north, so this flips.
    y: offsetY + (maxY - ys[i]) * scale,
    hole: entry.hole,
  }));

  return { width: PREVIEW_WIDTH, height, points };
}

/** The walking line, as an SVG path. Straight legs on purpose — this is a
 * diagram of the order, not a claim about which streets you take. */
export function routePath(points: PreviewPoint[]): string {
  if (!points.length) return "";
  return points
    .map((point, i) => `${i === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}
