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
 * What the app *is*, for the surfaces that get one sentence: the home page's
 * `<meta name="description">` and the schema.org block beside it.
 *
 * TAGLINE is a slogan — it is the voice, and it tells a stranger nothing.
 * Google's brand verification rejected a home page that led with one
 * ("your home page does not explain the purpose of your app"), so this spells
 * the product out instead, and both surfaces read it from here so the two
 * cannot drift into disagreeing about what this is.
 */
export const DESCRIPTION =
  `${APP_NAME} is a free scorecard app for pub golf: build a course of ` +
  "pubs, share a six-character code, and every phone at the table keeps " +
  "the same live card.";

/**
 * Google Search Console's HTML-tag proof of ownership, rendered into every
 * page's head.
 *
 * Brand verification will not pass a home page whose domain is not verified
 * to the account that owns the Cloud project — "the website of your home
 * page URL is not registered to you" — and no amount of page copy answers
 * it. A DNS TXT record on `glyn.dev` is the better proof, because one Domain
 * property covers this subdomain *and* the `glyn.dev` authorized domain the
 * consent screen lists; this is the fallback that verifies
 * `https://pub-golf.glyn.dev/` as a URL-prefix property without touching DNS.
 *
 * The token is public by design — it ships in the HTML — and is an env var
 * only so that proving ownership does not need a code change. Setting it in
 * Vercel takes a **redeploy** to appear: prerendered pages bake in whatever
 * the value was at build time, and Vercel only hands a changed variable to
 * new deployments anyway.
 */
export const SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION ?? null;

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
