import { type LatLng } from "@/lib/geo";
import { primaryLanguage } from "@/lib/locale";
import {
  buildPlacesSearch,
  parseBounds,
  PLACES_FIELD_MASK,
} from "@/lib/pub-search";
import { createClient } from "@/lib/supabase/server";

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
}

/** The player's city as Vercel's edge saw it — the default aim for a search
 * that carries no viewport. Absent locally and on other hosts, and that is
 * fine: the request just goes out unaimed, as every request did before. */
function ipBiasFrom(headers: Headers): LatLng | null {
  const lat = Number.parseFloat(headers.get("x-vercel-ip-latitude") ?? "");
  const lng = Number.parseFloat(headers.get("x-vercel-ip-longitude") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Server-side Google Places (New) search. The key never reaches the
 * browser; results are upserted into the shared `venues` cache so the
 * round never needs Google again after build time. Without a key the
 * route degrades gracefully and the builder falls back to manual entry.
 *
 * Two shapes of question: a query is a Text Search (aimed at the given
 * viewport, else at the player's IP city); no query but a viewport is the
 * map asking what's here — Nearby Search for pubs and bars.
 */
export async function POST(request: Request) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return Response.json({ degraded: true, results: [], bias: null });

  let payload: { query?: unknown; bounds?: unknown };
  try {
    payload = (await request.json()) as { query?: unknown; bounds?: unknown };
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const query =
    typeof payload.query === "string" && payload.query.trim()
      ? payload.query.trim()
      : null;
  const bounds = parseBounds(payload.bounds);

  // Only signed-in members spend the quota.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const bias = ipBiasFrom(request.headers);
  const search = buildPlacesSearch({
    query,
    bounds,
    ipBias: bias,
    language: primaryLanguage(request.headers.get("accept-language")),
  });
  if (!search)
    return Response.json({ degraded: false, results: [], bias: null });

  const response = await fetch(search.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify(search.body),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error(`Places search failed (${response.status}): ${detail}`);
    const referrerBlocked = detail.includes("API_KEY_HTTP_REFERRER_BLOCKED");
    return Response.json(
      {
        error: referrerBlocked
          ? "The Places key is website-restricted — server keys need the restriction set to None or IP addresses in the Google Cloud console"
          : "Places search failed",
      },
      { status: 502 },
    );
  }

  const data = (await response.json()) as { places?: GooglePlace[] };
  const places = (data.places ?? []).filter(
    (place) => place.id && place.displayName?.text,
  );
  if (places.length === 0)
    return Response.json({ degraded: false, results: [], bias });

  const rows = places.map((place) => ({
    google_place_id: place.id,
    name: place.displayName?.text ?? "",
    address: place.formattedAddress ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    rating: place.rating ?? null,
    review_count: place.userRatingCount ?? null,
    fetched_at: new Date().toISOString(),
  }));

  const { data: venues, error } = await supabase
    .from("venues")
    .upsert(rows, { onConflict: "google_place_id" })
    .select();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Preserve Google's relevance order.
  const byPlaceId = new Map(
    (venues ?? []).map((venue) => [venue.google_place_id, venue]),
  );
  const results = places
    .map((place) => byPlaceId.get(place.id))
    .filter(Boolean);

  return Response.json({ degraded: false, results, bias });
}
