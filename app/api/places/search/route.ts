import { createClient } from "@/lib/supabase/server";

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
}

/**
 * Server-side Google Places (New) text search. The key never reaches the
 * browser; results are upserted into the shared `venues` cache so the
 * round never needs Google again after build time. Without a key the
 * route degrades gracefully and the builder falls back to manual entry.
 */
export async function POST(request: Request) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return Response.json({ degraded: true, results: [] });

  let query: unknown;
  try {
    ({ query } = await request.json());
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (typeof query !== "string" || !query.trim())
    return Response.json({ degraded: false, results: [] });

  // Only signed-in members spend the quota.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({ textQuery: query.trim(), pageSize: 8 }),
    },
  );
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
    return Response.json({ degraded: false, results: [] });

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

  return Response.json({ degraded: false, results });
}
