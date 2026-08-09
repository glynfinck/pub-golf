/**
 * Identity. The app is Pub Golf — the "Parlour" working name is retired, so
 * the platform and its flagship game are now the same words. FLAGSHIP_GAME
 * stays as its own export because the copy that names the game reads
 * differently from the copy that names the app, and a platform with a second
 * game would want them apart again.
 */
/**
 * Where the app is served from. Only ever read for absolute URLs in metadata —
 * an Open Graph image cannot be advertised at a relative path, and a crawler
 * has no origin to resolve one against.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://pub-golf.glyn.dev";

export const APP_NAME = "Pub Golf";
export const FLAGSHIP_GAME = "Pub Golf";
export const TAGLINE = "Nine pubs. Par 36. Lowest swigs wins.";

/**
 * Where the club secretary reads mail. Printed on the public tariff and
 * small-print pages — the surfaces a payment processor reviews — so it
 * lives here rather than inline in either.
 */
export const SUPPORT_EMAIL = "glynfinck@gmail.com";
