export interface LatLng {
  lat: number;
  lng: number;
}

/** A map viewport, Google-style: north/south latitudes, east/west
 * longitudes. East may read numerically below west when the viewport
 * crosses the antimeridian. */
export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Great-circle distance in km. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * A pub-crawl walking estimate: ~4.8 km/h as the crow staggers, at least
 * a minute. Good enough for a countdown; the caddy tees up on arrival
 * regardless. Returns null without coordinates for both ends.
 */
/** Minutes per kilometre, as the crow staggers — about 4.8 km/h. One constant,
 * because two things now convert between distance and time: this estimate, and
 * the minimum leg the caddy's router spaces a crawl by. */
export const WALK_MINUTES_PER_KM = 12.5;

/** Minutes back into kilometres, for anyone stating a rule in minutes. */
export function kmForWalkMinutes(minutes: number): number {
  return minutes / WALK_MINUTES_PER_KM;
}

export function estimateWalkMinutes(
  from: { lat: number | null; lng: number | null } | null,
  to: { lat: number | null; lng: number | null } | null,
): number | null {
  if (
    from?.lat == null ||
    from.lng == null ||
    to?.lat == null ||
    to.lng == null
  )
    return null;
  const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
  return Math.max(1, Math.round(km * WALK_MINUTES_PER_KM));
}

/**
 * The circle that covers a viewport: centred on the bounds, radius out to a
 * corner. Nearby Search only takes circles, and only up to 50 km — a
 * zoomed-out map gets the biggest circle Google will answer rather than an
 * error, and the 100 m floor keeps a fully-zoomed street asking a
 * street-sized question.
 */
export function boundsToCircle(bounds: Bounds): {
  center: LatLng;
  radiusMeters: number;
} {
  const lat = (bounds.north + bounds.south) / 2;
  // Across the antimeridian the eastern edge reads below the western one:
  // walk half the eastward span and wrap back into range.
  const span =
    bounds.east >= bounds.west
      ? bounds.east - bounds.west
      : bounds.east + 360 - bounds.west;
  let lng = bounds.west + span / 2;
  if (lng > 180) lng -= 360;
  const radiusKm = haversineKm(lat, lng, bounds.north, bounds.east);
  return {
    center: { lat, lng },
    radiusMeters: Math.min(50_000, Math.max(100, Math.round(radiusKm * 1000))),
  };
}

/**
 * A square viewport centred on a point — for aiming a patch search at a
 * spot the camera has not settled on yet (the just-located player).
 */
export function boundsAround(center: LatLng, radiusMeters: number): Bounds {
  const dLat = radiusMeters / 111_320;
  const cosLat = Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  const dLng = radiusMeters / (111_320 * cosLat);
  const wrap = (lng: number) => (lng > 180 ? lng - 360 : lng < -180 ? lng + 360 : lng);
  return {
    north: Math.min(90, center.lat + dLat),
    south: Math.max(-90, center.lat - dLat),
    east: wrap(center.lng + dLng),
    west: wrap(center.lng - dLng),
  };
}
