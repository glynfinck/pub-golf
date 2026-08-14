import "server-only";

/**
 * Street-verified minutes for the finished card's legs.
 *
 * Every distance in the router is haversine, which in most of a city is a
 * uniform, harmless understatement — and across a river or a railway is a
 * lie at the exact moment the group is stood on the wrong bank. Verifying
 * *everything* would cost a fortune (a 40-candidate patch is 1,600 pairs);
 * verifying the card that actually shipped is at most seventeen walking
 * routes, which is pennies, and it turns the card's walk from an estimate
 * into a promise.
 *
 * **Graceful absence throughout.** No key, a slow answer, a refusal — every
 * failure returns null for that leg and the card ships exactly as it would
 * have before this module existed. Verification is a garnish on a correct
 * card, never a gate in front of one.
 */

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
/** One leg's answer, or the card waits on a stuck socket. */
const LEG_TIMEOUT_MS = 4_000;

/** The key that may verify: its own, or the server's Places key where the
 * project enabled both APIs on one credential. */
export function routesKey(env: NodeJS.ProcessEnv): string | null {
  return env.GOOGLE_ROUTES_API_KEY ?? env.GOOGLE_PLACES_API_KEY ?? null;
}

interface Point {
  lat: number | null;
  lng: number | null;
}

async function walkSeconds(
  key: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LEG_TIMEOUT_MS);
  try {
    const response = await fetch(ROUTES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        // Duration only: the whole point is one number per leg.
        "X-Goog-FieldMask": "routes.duration",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "WALK",
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      routes?: { duration?: string }[];
    };
    const duration = data.routes?.[0]?.duration;
    if (typeof duration !== "string") return null;
    const seconds = Number.parseInt(duration, 10);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walking minutes for each leg of the card, `null` where the streets could
 * not answer. Length is always `holes.length - 1`, so a consumer can zip it
 * against the legs without counting.
 */
export async function verifyLegs(
  holes: Point[],
  key: string | null,
): Promise<(number | null)[]> {
  const legs = Math.max(holes.length - 1, 0);
  if (!key || legs === 0) return new Array(legs).fill(null);
  const answers = await Promise.all(
    Array.from({ length: legs }, (_, i) => {
      const from = holes[i];
      const to = holes[i + 1];
      if (from.lat == null || from.lng == null || to.lat == null || to.lng == null) {
        return Promise.resolve(null);
      }
      return walkSeconds(
        key,
        { lat: from.lat, lng: from.lng },
        { lat: to.lat, lng: to.lng },
      );
    }),
  );
  return answers.map((seconds) =>
    seconds === null ? null : Math.max(1, Math.round(seconds / 60)),
  );
}
