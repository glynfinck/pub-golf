import { candidateFloor, HOLE_CHOICES } from "@/lib/caddy/brief";

/**
 * Pre-flight: what the host can be told about a patch *before* the fee.
 *
 * Four silent resolutions sit between typing "Camden" and a card — the
 * geocode, the centre, the radius, the gather — and most bad cards are bad
 * patches. This module turns the free lean search the brief already makes
 * into the three answers that close those loops early: where the name
 * actually resolved (the echo), how much there is to work with (the count),
 * and whether the round being asked for can be built there at all (the
 * counter-offer). All pure; the search results come in as arguments.
 *
 * The count is a floor, not a fact: the lean search is one text query capped
 * at twenty, where the gather rings the whole patch. So the counter-offer is
 * a warning in the hazard voice, never a refusal — the server still decides,
 * exactly as it always has.
 */

export interface PatchPreview {
  /** The pubs the lean search placed, as pins for the map. */
  pins: { id: string; lat: number; lng: number }[];
  /** How many the search found, placed or not. */
  count: number;
  /** The area name the search results agree on, or null when they don't. */
  locality: string | null;
}

/** A UK postcode, to be stripped before address segments are compared —
 * "London NW1 0LT" and "London N1 9AB" are the same place. Google also
 * writes bare outward codes ("London NW1"), so a trailing one goes too. */
const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g;
const OUTWARD_TAIL = /\s+[A-Z]{1,2}\d[A-Z\d]?$/;
const COUNTRYISH = new Set(["uk", "united kingdom", "england", "scotland", "wales"]);

/**
 * The area a set of addresses agrees on.
 *
 * Each formatted address is split into its comma segments; the street goes,
 * the country goes, postcodes are stripped, and whatever named segment most
 * of the results share is the echo. Null when nothing wins clearly — an
 * uncertain chip is worse than no chip.
 */
export function localityOf(addresses: (string | null)[]): string | null {
  const votes = new Map<string, { count: number; label: string }>();
  let voters = 0;
  for (const address of addresses) {
    if (!address) continue;
    const segments = address
      .split(",")
      .map((part) => part.replace(POSTCODE, "").replace(OUTWARD_TAIL, "").trim())
      .filter(Boolean)
      // The first segment is the street number and name; never a locality.
      .slice(1)
      .filter((part) => !COUNTRYISH.has(part.toLowerCase()));
    if (segments.length === 0) continue;
    voters += 1;
    // One vote per address per distinct segment, so "London" inside two
    // segments of one address does not count twice.
    const seen = new Set<string>();
    for (const segment of segments) {
      const key = segment.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = votes.get(key) ?? { count: 0, label: segment };
      entry.count += 1;
      votes.set(key, entry);
    }
  }
  if (voters < 2) return null;
  const ranked = [...votes.values()].sort((a, b) => b.count - a.count);
  const winner = ranked[0];
  // A majority, not a plurality: the echo is a claim about where the caddy
  // will look, and a claim needs most of the evidence behind it.
  return winner && winner.count * 2 > voters ? winner.label : null;
}

/** Search rows as the preview holds them. Shaped to what the lean search
 * answers with, but structurally — no dependency on the venues table type. */
export function previewOf(
  results: {
    id: string;
    lat: number | null;
    lng: number | null;
    address: string | null;
  }[],
): PatchPreview {
  return {
    pins: results
      .filter(
        (row): row is typeof row & { lat: number; lng: number } =>
          row.lat != null && row.lng != null,
      )
      .slice(0, 40)
      .map((row) => ({ id: row.id, lat: row.lat, lng: row.lng })),
    count: results.length,
    locality: localityOf(results.map((row) => row.address)),
  };
}

/** The chip on the map: where the name resolved, and how much is there. */
export function echoLine(preview: PatchPreview): string | null {
  if (preview.count === 0) return null;
  const pubs = `${preview.count} pub${preview.count === 1 ? "" : "s"} nearby`;
  return preview.locality ? `${preview.locality} · ${pubs}` : pubs;
}

/**
 * The counter-offer, where the patch looks too thin for the round asked.
 *
 * Every refusal that becomes a counter-offer before the button is a failed
 * plan that never happened. Softened to "looks thin" because the count is a
 * floor — the gather may find more — and the offer names the hole count that
 * fits what can be seen, which is the honest lever the host actually has.
 */
export function thinPatchNote(count: number, holes: number): string | null {
  if (count === 0) return null;
  if (count >= candidateFloor(holes)) return null;
  const fits = [...HOLE_CHOICES]
    .sort((a, b) => b - a)
    .find((choice) => candidateFloor(choice) <= count);
  return fits
    ? `Looks thin round there — ${count} pub${count === 1 ? "" : "s"} found. ${fits} holes fits what we can see, or widen the patch.`
    : `Looks thin round there — ${count} pub${count === 1 ? "" : "s"} found. A bigger town or a wider patch will play better.`;
}
