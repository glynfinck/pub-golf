import { boundsToCircle, type Bounds, type LatLng } from "@/lib/geo";
import type { Tables } from "@/types/supabase-helpers";

/** What /api/places/search answers with, list and map alike. */
export interface PubSearchResponse {
  degraded: boolean;
  results: Tables<"venues">[];
  /** Where the search was aimed when the caller gave no viewport — the
   * player's IP-derived city, from the request's geo headers. The map
   * opens here when it has nothing better. */
  bias: LatLng | null;
  error?: string;
}

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const NEARBY_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchNearby";

/** Everything either Places (New) endpoint is asked to return. */
export const PLACES_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount";

// How wide to aim when the only fix on the player is their IP city: a text
// query is a name worth finding anywhere nearby, the bare what's-here case
// stays walking-radius.
const IP_TEXT_RADIUS_M = 5_000;
const IP_NEARBY_RADIUS_M = 3_000;

/** A viewport off the wire: numbers in range, north above south, or null. */
export function parseBounds(value: unknown): Bounds | null {
  if (typeof value !== "object" || value === null) return null;
  const { north, south, east, west } = value as Record<string, unknown>;
  if (
    typeof north !== "number" ||
    typeof south !== "number" ||
    typeof east !== "number" ||
    typeof west !== "number"
  )
    return null;
  if (![north, south, east, west].every(Number.isFinite)) return null;
  if (north <= south) return null;
  if (Math.abs(north) > 90 || Math.abs(south) > 90) return null;
  if (Math.abs(east) > 180 || Math.abs(west) > 180) return null;
  return { north, south, east, west };
}

export interface PlacesSearch {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Shape the Places (New) request for what the caller actually knows. A query
 * is a Text Search, aimed at the viewport when there is one and at the
 * player's IP city when there is not — an unaimed query lets Google guess
 * from the *server's* address, which is a Vercel data centre, not the
 * player. No query means the map is asking what's here: Nearby Search for
 * pubs and bars. Nothing to aim with at all → null, and the route answers
 * empty rather than asking Google an unanswerable question.
 */
export function buildPlacesSearch({
  query,
  bounds,
  ipBias,
  language,
}: {
  query: string | null;
  bounds: Bounds | null;
  ipBias: LatLng | null;
  language: string | null;
}): PlacesSearch | null {
  const languageCode = language ? { languageCode: language } : {};
  if (query) {
    const locationBias = bounds
      ? {
          rectangle: {
            low: { latitude: bounds.south, longitude: bounds.west },
            high: { latitude: bounds.north, longitude: bounds.east },
          },
        }
      : ipBias
        ? {
            circle: {
              center: { latitude: ipBias.lat, longitude: ipBias.lng },
              radius: IP_TEXT_RADIUS_M,
            },
          }
        : null;
    return {
      url: TEXT_SEARCH_URL,
      body: {
        textQuery: query,
        // The list under the field shows eight; a map patch can hold a round.
        pageSize: bounds ? 20 : 8,
        ...languageCode,
        ...(locationBias ? { locationBias } : {}),
      },
    };
  }

  const circle = bounds
    ? boundsToCircle(bounds)
    : ipBias
      ? { center: ipBias, radiusMeters: IP_NEARBY_RADIUS_M }
      : null;
  if (!circle) return null;
  return {
    url: NEARBY_SEARCH_URL,
    body: {
      includedTypes: ["pub", "bar"],
      maxResultCount: 20,
      rankPreference: "POPULARITY",
      ...languageCode,
      locationRestriction: {
        circle: {
          center: {
            latitude: circle.center.lat,
            longitude: circle.center.lng,
          },
          radius: circle.radiusMeters,
        },
      },
    },
  };
}

/** The one way the browser asks for pubs — the list and the map share it. */
export async function searchPubs(input: {
  query?: string;
  bounds?: Bounds;
}): Promise<PubSearchResponse> {
  const response = await fetch("/api/places/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await response.json()) as Partial<PubSearchResponse>;
  return {
    degraded: Boolean(data.degraded),
    results: data.results ?? [],
    bias: data.bias ?? null,
    ...(data.error ? { error: data.error } : {}),
  };
}
