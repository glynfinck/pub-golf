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
export function mapIdForTheme(resolvedTheme: string | undefined): string {
  const cream = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_CREAM;
  const midnight = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_MIDNIGHT;
  return (
    (resolvedTheme === "dark" ? (midnight ?? cream) : (cream ?? midnight)) ??
    "DEMO_MAP_ID"
  );
}
