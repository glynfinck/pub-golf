import "server-only";

import {
  EMPTY_FACTS,
  type PubFacts,
  type PubSource,
} from "@/lib/caddy/dossier";
import { windowsOf } from "@/lib/caddy/hours";
import { interleaveRings } from "@/lib/caddy/rings";
import { strokeCircles, type StrokePoint } from "@/lib/caddy/stroke";
import { corridorSamples, haversineKm } from "@/lib/geo";
import { isDrinkingPlace, PLACES_FIELD_MASK } from "@/lib/pub-search";

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
 * The builder's mask plus what the caddy reads the room with.
 *
 * Two jobs, and they are worth telling apart. Most of these fields are the
 * `signal` behind a particular in `lib/caddy/brief.ts` — the pairing keeps the
 * preferences menu honest, and a unit test holds it. `servesBeer` and
 * `servesWine` are not chips and never will be; they are here so the caddy can
 * tell whether the drink it is about to write on a hole is one the place
 * actually pours. A cocktail bar that serves no beer is a real thing, and
 * "Pint of bitter" on its hole sends the group to the bar to be told no.
 */
export const CADDY_FIELD_MASK = [
  PLACES_FIELD_MASK,
  "places.priceLevel",
  "places.outdoorSeating",
  "places.allowsDogs",
  "places.servesBeer",
  "places.servesWine",
  "places.servesCocktails",
  "places.liveMusic",
  "places.goodForWatchingSports",
  "places.goodForGroups",
  "places.editorialSummary",
  "places.reviews",
  // A route is a schedule: the router refuses to build a walk that reaches
  // a pub after it shuts, and these are what "shuts" means.
  "places.regularOpeningHours",
].join(",");

const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
/** A walk, not a bus ride: the radius one leg of a crawl should stay inside. */
const PATCH_RADIUS_M = 1_200;

/**
 * How wide a corridor between two areas is, per sample.
 *
 * Narrower than a single patch on purpose. Two areas four kilometres apart
 * searched at the full patch radius are two fat blobs with a gap: the gather
 * comes back with everything around both ends and nothing in between, and the
 * router can only pick a route that hops between them. Half the radius, with
 * enough samples to overlap, draws a line and gathers what is beside it —
 * which is what a host walking from one place to another actually passes.
 */
const CORRIDOR_RADIUS_M = 600;
/** Circles sampled down the line when both tees are pinned. */

interface GooglePlace {
  id?: string;
  /** What the place mostly *is*. Checked, not trusted to the request. */
  primaryType?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  outdoorSeating?: boolean;
  allowsDogs?: boolean;
  servesBeer?: boolean;
  servesWine?: boolean;
  servesCocktails?: boolean;
  liveMusic?: boolean;
  goodForWatchingSports?: boolean;
  goodForGroups?: boolean;
  editorialSummary?: { text?: string };
  reviews?: { text?: { text?: string } }[];
  regularOpeningHours?: {
    periods?: {
      open?: { day?: number; hour?: number; minute?: number };
      close?: { day?: number; hour?: number; minute?: number };
    }[];
  };
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
  const read = (value: boolean | undefined) =>
    value === undefined ? null : value;
  return {
    outdoorSeating: read(place.outdoorSeating),
    allowsDogs: read(place.allowsDogs),
    servesBeer: read(place.servesBeer),
    servesWine: read(place.servesWine),
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
  // The request asked for drinking places; this checks the answer. A request
  // parameter is a preference and this is a promise — sending a group to a
  // door that is a restaurant is the worst thing this app can do, and it is
  // barely better than sending them to one that is not there.
  if (!isDrinkingPlace(place.primaryType)) return null;
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
    hours: windowsOf(place.regularOpeningHours?.periods),
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
    // `includedPrimaryTypes`, not `includedTypes`, and the difference is the
    // whole rule. `includedTypes` matches *any* type a place carries, and
    // Google hangs "bar" on plenty of places that are not one — a nightclub
    // with a bar in it, a restaurant with a bar in it. That is how a club and
    // a tapas restaurant ended up on a crawl. The primary type is what the
    // place mostly *is*, which is the question being asked.
    includedPrimaryTypes: ["pub", "bar", "wine_bar"],
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
  /**
   * Where the night finishes, in the host's words. Empty for a single patch.
   *
   * Resolved here rather than passed in as coordinates, because a *named* area
   * is what the host actually typed and pinned venues are a different feature.
   * Without this the corridor could only ever be drawn between two dropped
   * pins — so a host who asked to finish in Covent Garden got pubs around
   * where they started and a route that stopped a mile short, not because the
   * router refused to go but because nothing out there was ever gathered.
   */
  whereTo: string;
  /** Coordinates of pinned tees, where the host dropped them. */
  start: { lat: number; lng: number } | null;
  finish: { lat: number; lng: number } | null;
  /** The walk, drawn. When present the circles sample down this line and
   * the named areas keep only their words. */
  stroke: StrokePoint[] | null;
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
export interface Gathered {
  pubs: GatheredPub[];
  /** Where the two named areas actually resolved to. Handed back rather than
   * kept, because the router needs them: a corridor tells the gather *where*
   * to look and tells the walk *which way to face*, and without the second the
   * route can march the right line in the wrong direction. */
  from: { lat: number; lng: number } | null;
  to: { lat: number; lng: number } | null;
}

export async function gatherPubs(input: GatherInput): Promise<Gathered> {
  const { key, language } = input;

  /**
   * Turn an area's name into a point, by asking what pubs are in it.
   *
   * The mean of the answers rather than the first: "Covent Garden" returns
   * pubs *around* Covent Garden and the first can sit at its edge, which drags
   * a corridor end off by a few hundred metres before anything else happens.
   *
   * **What it returns is a point, and nothing else.** These results used to be
   * pushed onto `found` alongside the Nearby rings, and that put them through
   * the one gap in `isDrinkingPlace`: a result carrying no `primaryType` at
   * all is admitted, deliberately, because dropping a genuine pub over a thin
   * response is the worse failure. That argument holds for Nearby, whose
   * *request* already said `includedPrimaryTypes: pub, bar, wine_bar` — an
   * untyped row from there was asked for as a pub. It does not hold here.
   * This leg asks Google an English sentence, `pubs in Shoreditch`, with no
   * type restriction at all, so an untyped row is a row nothing has ever
   * checked. A card that sends nine people to a hotel lobby is the same
   * failure as one that sends them to a door that isn't there.
   *
   * So this leg locates the area and steps back. Filling the patch is Nearby's
   * job, under Nearby's restriction.
   */
  const locate = async (
    query: string,
    bias: { lat: number; lng: number } | null,
  ) => {
    if (!query.trim()) return null;
    const places = await call(
      key,
      TEXT_URL,
      {
        textQuery: `pubs in ${query.trim()}`,
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
    const placed = places
      .filter((place) => place.location)
      .slice(0, 5)
      .map((place) => ({
        lat: place.location!.latitude as number,
        lng: place.location!.longitude as number,
      }));
    if (placed.length === 0) return null;
    return {
      lat: placed.reduce((sum, p) => sum + p.lat, 0) / placed.length,
      lng: placed.reduce((sum, p) => sum + p.lng, 0) / placed.length,
    };
  };

  // A drawn walk is the most concrete brief there is: its circles are the
  // gather, its ends are the aim, and no locating search is needed at all.
  if (input.stroke && input.stroke.length >= 2) {
    const centres = strokeCircles(input.stroke, CORRIDOR_RADIUS_M / 1000);
    const rings = await Promise.all(
      centres.map((centre) =>
        call(key, NEARBY_URL, nearbyBody(centre, CORRIDOR_RADIUS_M), language),
      ),
    );
    return {
      // Rank-interleaved, not circle-concatenated: the candidate cap is a
      // budget, and flattening in circle order spent all of it on the first
      // few circles — the opening quarter of the host's own line.
      pubs: dedupe(interleaveRings(rings)),
      from: input.stroke[0],
      to: input.stroke[input.stroke.length - 1],
    };
  }

  // Pinned tees win where the host dropped them; otherwise the two named areas
  // are located and become the ends of the walk themselves.
  let from = input.start;
  let to = input.finish;
  if (!from || !to) {
    const [namedFrom, namedTo] = await Promise.all([
      from ? Promise.resolve(from) : locate(input.where, input.ipBias),
      to ? Promise.resolve(to) : locate(input.whereTo, input.ipBias),
    ]);
    from = from ?? namedFrom;
    to = to ?? namedTo;
  }

  const corridor = Boolean(from && to);
  const centres: { lat: number; lng: number }[] = [];
  if (from && to) {
    const samples = corridorSamples(
      haversineKm(from.lat, from.lng, to.lat, to.lng),
      CORRIDOR_RADIUS_M / 1000,
    );
    for (let i = 0; i < samples; i++) {
      // Evenly down the line, ends included. Guarded so a future single-sample
      // corridor lands on the start rather than on NaN.
      const t = i / Math.max(1, samples - 1);
      centres.push({
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
      });
    }
  } else if (from || to) {
    centres.push((from ?? to) as { lat: number; lng: number });
  }

  if (!centres.length && input.ipBias) centres.push(input.ipBias);

  // Fill the patch. Independent circles, so they go out together.
  const rings = await Promise.all(
    centres.map((centre) =>
      call(
        key,
        NEARBY_URL,
        nearbyBody(centre, corridor ? CORRIDOR_RADIUS_M : PATCH_RADIUS_M),
        language,
      ),
    ),
  );
  // Same rule as the stroke's: a corridor is a line too, and concatenating
  // its samples put the far end of the walk outside the cap.
  return { pubs: dedupe(interleaveRings(rings)), from, to };
}

/** Places to pubs, first appearance wins. The interleave has already decided
 * the order; this only drops what is not a pub and what is already in. */
function dedupe(places: GooglePlace[]): GatheredPub[] {
  const seen = new Set<string>();
  const gathered: GatheredPub[] = [];
  for (const place of places) {
    const pub = toGathered(place);
    if (!pub || seen.has(pub.googlePlaceId)) continue;
    seen.add(pub.googlePlaceId);
    gathered.push(pub);
  }
  return gathered;
}
