/**
 * Browser-side Maps JS config. The env vars are referenced statically so
 * Next inlines them at build; without the key the builder never renders a
 * map affordance and nothing Google reaches the page.
 */
export const MAPS_BROWSER_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/**
 * The cloud style for the active theme — two styles authored in the Google
 * Cloud console from the tokens in globals.css. Either falls back to the
 * other, and with neither configured the demo map ID keeps Advanced
 * Markers rendering over Google's stock styling, with colorScheme still
 * following the app theme.
 */
/** The style IDs this build was compiled with — statically referenced so
 * Next inlines them, and exported so the sheet can say out loud when a
 * build is wearing stock styling for want of them. */
export const MAP_STYLE_IDS = {
  cream: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_CREAM,
  midnight: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_MIDNIGHT,
};

let reportedMapIds = false;

export function mapIdForTheme(resolvedTheme: string | undefined): string {
  const { cream, midnight } = MAP_STYLE_IDS;
  // Say once, in the console, which styles this build actually carries —
  // "why is the map stock?" bisects instantly between a build missing its
  // env vars and a Google-side style that never published.
  if (!reportedMapIds && typeof window !== "undefined") {
    reportedMapIds = true;
    console.info(
      cream || midnight
        ? `pub-golf map styles: cream=${cream ?? "(unset)"} midnight=${midnight ?? "(unset)"}`
        : "pub-golf map styles: no map IDs in this build — stock Google styling",
    );
  }
  return (
    (resolvedTheme === "dark" ? (midnight ?? cream) : (cream ?? midnight)) ??
    "DEMO_MAP_ID"
  );
}
