/**
 * The origin this deployment should advertise itself at.
 *
 * Only ever read for absolute URLs in metadata. Open Graph images cannot be
 * advertised at a relative path — a crawler has no origin to resolve one
 * against — so whatever this returns is the host every unfurled link will be
 * fetched from.
 *
 * Which makes getting it wrong quiet and total: a preview deployment that
 * advertised the production domain would send every crawler to a different
 * build of the app, and if production has not shipped the card route yet, to
 * a 404. The link simply renders bare, with nothing in any log to say why.
 *
 * Server-only on purpose. `VERCEL_*` are not `NEXT_PUBLIC_`, so they are
 * undefined in the browser bundle; keeping this out of `lib/config.ts` (which
 * client components import for the app name) stops the two ever disagreeing.
 */
function resolveSiteUrl(): string {
  // An explicit setting always wins — a custom domain, or a local run that
  // wants its own cards.
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  // On Vercel, let each deployment speak for itself. VERCEL_URL is *this*
  // deployment; VERCEL_PROJECT_PRODUCTION_URL is the stable production domain.
  // Preview wants the former — pointing a preview's cards at production is
  // how you end up debugging an image that was never going to be there.
  const { VERCEL_ENV, VERCEL_URL, VERCEL_PROJECT_PRODUCTION_URL } = process.env;
  if (VERCEL_ENV === "preview" && VERCEL_URL) return `https://${VERCEL_URL}`;
  if (VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${VERCEL_PROJECT_PRODUCTION_URL}`;
  if (VERCEL_URL) return `https://${VERCEL_URL}`;

  return "https://pub-golf.glyn.dev";
}

export const SITE_URL = resolveSiteUrl();
