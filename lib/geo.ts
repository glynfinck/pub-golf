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
  return Math.max(1, Math.round(km * 12.5));
}
