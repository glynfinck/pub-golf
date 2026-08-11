import "server-only";

import { boundsAround } from "@/lib/geo";
import { EMPTY_FACTS, type PubFacts, type PubSource } from "@/lib/caddy/dossier";
import { PLACES_FIELD_MASK } from "@/lib/pub-search";

/**
 * The gather: the caddy's own question to Places.
 *
 * The builder's search asks a lean question — enough to put a pub on a card.
 * The caddy asks a richer one, because it is choosing rather than listing: the
 * atmosphere facts behind every particular a host can tick, the price level,
 * Google's own summary, and a couple of review snippets. That is a dearer SKU,
 * paid **once per patch** — every roll and every tweak re-reads the same
 * gathered set, so the second card costs no Google at all.
 *
 * The request shaping still goes through `buildPlacesSearch`; this module adds
 * a field mask and a corridor, and nothing else.
 */

/**
 * The builder's mask plus what the caddy reads the room with. Every field
 * after the first line is the `signal` behind a particular in
 * `lib/caddy/brief.ts` — the pairing is what keeps the preferences menu
 * honest, and a unit test holds it.
 */
export const CADDY_FIELD_MASK = [
  PLACES_FIELD_MASK,
  "places.priceLevel",
  "places.outdoorSeating",
  "places.allowsDogs",
  "places.servesCocktails",
  "places.liveMusic",
  "places.goodForWatchingSports",
  "places.goodForGroups",
  "places.editorialSummary",
  "places.reviews",
].join(",");

const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
/** A walk, not a bus ride: the radius one leg of a crawl should stay inside. */
const PATCH_RADIUS_M = 1_200;
/** Circles sampled down the line when both tees are pinned. */
const CORRIDOR_SAMPLES = 3;

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  outdoorSeating?: boolean;
  allowsDogs?: boolean;
  servesCocktails?: boolean;
  liveMusic?: boolean;
  goodForWatchingSports?: boolean;
  goodForGroups?: boolean;
  editorialSummary?: { text?: string };
  reviews?: { text?: { text?: string } }[];
}

/** Google's price level enum, as the 0–4 the dossier prints. */
function priceOf(level: string | undefined): number | null {
  const scale: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return level && level in scale ? scale[level] : null;
}

function factsOf(place: GooglePlace): PubFacts {
  const read = (value: boolean | undefined) => (value === undefined ? null : value);
  return {
    outdoorSeating: read(place.outdoorSeating),
    allowsDogs: read(place.allowsDogs),
    servesCocktails: read(place.servesCocktails),
    liveMusic: read(place.liveMusic),
    goodForWatchingSports: read(place.goodForWatchingSports),
    goodForGroups: read(place.goodForGroups),
  };
}

export interface GatheredPub extends Omit<PubSource, "venueId"> {
  googlePlaceId: string;
}

function toGathered(place: GooglePlace): GatheredPub | null {
  const name = place.displayName?.text;
  if (!place.id || !name) return null;
  return {
    googlePlaceId: place.id,
    name,
    address: place.formattedAddress ?? null,
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    priceLevel: priceOf(place.priceLevel),
    facts: place.id ? factsOf(place) : { ...EMPTY_FACTS },
    editorial: place.editorialSummary?.text ?? null,
    reviews: (place.reviews ?? [])
      .map((review) => review.text?.text ?? "")
      .filter(Boolean),
  };
}

async function call(
  key: string,
  url: string,
  body: Record<string, unknown>,
  language: string | null,
): Promise<GooglePlace[]> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": CADDY_FIELD_MASK,
    },
    body: JSON.stringify(language ? { ...body, languageCode: language } : body),
  });
  if (!response.ok) {
    console.error(`Caddy gather failed (${response.status})`);
    return [];
  }
  const data = (await response.json()) as { places?: GooglePlace[] };
  return data.places ?? [];
}

/** Pubs and bars around a point, at walking radius. */
function nearbyBody(center: { lat: number; lng: number }, radius: number) {
  return {
    includedTypes: ["pub", "bar"],
    maxResultCount: 20,
    rankPreference: "POPULARITY",
    locationRestriction: {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius,
      },
    },
  };
}

export interface GatherInput {
  key: string;
  /** The patch in the host's words. Empty when both tees are pinned. */
  where: string;
  /** Coordinates of pinned tees, where the host dropped them. */
  start: { lat: number; lng: number } | null;
  finish: { lat: number; lng: number } | null;
  /** The player's IP city, so an unaimed search follows the phone and not the
   * data centre — the same rule `buildPlacesSearch` already keeps. */
  ipBias: { lat: number; lng: number } | null;
  language: string | null;
}

/**
 * Find the patch, then fill it.
 *
 * With no pins: one Text Search locates the area, then a Nearby Search fans
 * around what it found. With both pinned: circles are sampled down the line
 * between them, so the candidates lie along the corridor the group will
 * actually walk rather than in a ring around a midpoint.
 */
export async function gatherPubs(input: GatherInput): Promise<GatheredPub[]> {
  const { key, language } = input;
  const centres: { lat: number; lng: number }[] = [];

  if (input.start && input.finish) {
    for (let i = 0; i < CORRIDOR_SAMPLES; i++) {
      // Evenly down the line, ends included. Guarded so a future single-sample
      // corridor lands on the start rather than on NaN.
      const t = i / Math.max(1, CORRIDOR_SAMPLES - 1);
      centres.push({
        lat: input.start.lat + (input.finish.lat - input.start.lat) * t,
        lng: input.start.lng + (input.finish.lng - input.start.lng) * t,
      });
    }
  } else if (input.start || input.finish) {
    centres.push((input.start ?? input.finish) as { lat: number; lng: number });
  }

  const found: GooglePlace[] = [];

  // A named patch is located first, so "Shoreditch" becomes a point before it
  // becomes a ring of pubs.
  if (input.where.trim()) {
    const bias = centres[0] ?? input.ipBias;
    const located = await call(
      key,
      TEXT_URL,
      {
        textQuery: `pubs in ${input.where.trim()}`,
        pageSize: 20,
        ...(bias
          ? {
              locationBias: {
                circle: {
                  center: { latitude: bias.lat, longitude: bias.lng },
                  radius: 5_000,
                },
              },
            }
          : {}),
      },
      language,
    );
    found.push(...located);
    const anchor = located.find((place) => place.location);
    if (!centres.length && anchor?.location) {
      centres.push({
        lat: anchor.location.latitude as number,
        lng: anchor.location.longitude as number,
      });
    }
  }

  if (!centres.length && input.ipBias) centres.push(input.ipBias);

  // Fill the patch. Independent circles, so they go out together.
  const rings = await Promise.all(
    centres.map((centre) =>
      call(key, NEARBY_URL, nearbyBody(centre, PATCH_RADIUS_M), language),
    ),
  );
  rings.forEach((ring) => found.push(...ring));

  const seen = new Set<string>();
  const gathered: GatheredPub[] = [];
  for (const place of found) {
    const pub = toGathered(place);
    if (!pub || seen.has(pub.googlePlaceId)) continue;
    seen.add(pub.googlePlaceId);
    gathered.push(pub);
  }
  return gathered;
}

/** The viewport a patch fills, for the map's opening camera. */
export function patchBounds(centre: { lat: number; lng: number }) {
  return boundsAround(centre, PATCH_RADIUS_M);
}
