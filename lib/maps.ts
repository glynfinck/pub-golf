/**
 * Browser-side Maps JS config. The env vars are referenced statically so
 * Next inlines them at build; without the key the builder never renders a
 * map affordance and nothing Google reaches the page.
 */
export const MAPS_BROWSER_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/**
 * The cloud-styled map ID — one ID carrying both the cream and Midnight
 * styles (masters in docs/map-styles/), with the map's colorScheme
 * selecting the variant. The two suffixed names are the earlier
 * one-style-per-ID shape, honoured so a deploy configured that way keeps
 * working. Exported so the sheet can say out loud when a build is wearing
 * stock styling for want of it.
 */
export const MAP_STYLE_ID =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ??
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_CREAM ??
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_MIDNIGHT;

let reportedMapId = false;

export function mapId(): string {
  // Say once, in the console, which style this build actually carries —
  // "why is the map stock?" bisects instantly between a build missing its
  // env var and a Google-side style that never published.
  if (!reportedMapId && typeof window !== "undefined") {
    reportedMapId = true;
    console.info(
      MAP_STYLE_ID
        ? `pub-golf map style: ${MAP_STYLE_ID}`
        : "pub-golf map style: no map ID in this build — stock Google styling",
    );
  }
  // Advanced Markers need some map ID; the demo one keeps them rendering
  // over Google's stock styling until the real one reaches the deploy.
  return MAP_STYLE_ID ?? "DEMO_MAP_ID";
}
