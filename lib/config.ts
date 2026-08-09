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

/**
 * The two grounds, as the browser chrome needs them: cream stock on `:root`
 * and the Midnight felt on `.dark`, copied from `app/globals.css`. Hand-kept
 * mirror, same as the one in `scripts/brand-lockups.mjs` — update together.
 */
export const GROUND = { light: "#f1edde", dark: "#101b13" } as const;

/**
 * Which build is running, short enough to read down a phone. Vercel sets the
 * SHA on every deploy; off Vercel there is no build to name, so the stamp
 * renders nothing rather than inventing "dev".
 *
 * The point is answering "it did something odd last night" without guessing.
 */
export const BUILD_REF = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
