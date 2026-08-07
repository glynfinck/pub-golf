/**
 * Platform identity. The working name is "Parlour" (naming study in the
 * design artifact — availability unverified); Pub Golf is the flagship game.
 */
/**
 * Where the app is served from. Only ever read for absolute URLs in metadata —
 * an Open Graph image cannot be advertised at a relative path, and a crawler
 * has no origin to resolve one against.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://pub-golf.glyn.dev";

export const APP_NAME = "Parlour";
export const FLAGSHIP_GAME = "Pub Golf";
export const TAGLINE = "Nine pubs. Par 36. Lowest swigs wins.";
