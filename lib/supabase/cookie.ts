/**
 * The name of the cookie the auth session lives in — stated, when it has to
 * be, rather than derived.
 *
 * supabase-js names the cookie after the first label of the project URL:
 *
 *     const defaultStorageKey = `sb-${baseUrl.hostname.split('.')[0]}-auth-token`
 *
 * which is fine until the origin moves. Putting the auth server behind
 * `auth.pub-golf.glyn.dev` — the Custom Domains add-on, so the browser stops
 * visibly bouncing through `quncylgcwfiqsjugnvtv.supabase.co` on the way to
 * Google — turns `sb-quncylgcwfiqsjugnvtv-auth-token` into `sb-auth-auth-token`
 * and orphans every session already in a browser.
 *
 * For a host that costs one Google tap. **For a guest it costs the seat**: an
 * anonymous session is the only thing holding their card, so a live round
 * would empty into `/round/CODE/rescue` mid-play. Hence a knob, and hence
 * shipping it *before* the origin changes rather than with it.
 *
 * Unset, this is byte-identical to today: no `cookieOptions` reaches the
 * factories and supabase-js derives the name as it always has. That is why
 * local dev and preview leave it alone — they each derive their own correct
 * name from their own URL, and hard-coding production's here would rename
 * their cookies instead.
 *
 * `NEXT_PUBLIC_` because the browser client reads it too, and read through a
 * static `process.env.X` reference so Next inlines it into the bundle.
 *
 * Set `cookieOptions.name`, never `auth.storageKey`: `@supabase/ssr` spreads
 * the two in opposite orders in its browser and server factories, so
 * `auth.storageKey` wins on the server while `cookieOptions.name` wins in the
 * browser, and the halves of the app end up disagreeing about which cookie
 * holds the session.
 */
export const cookieOptions = process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME
  ? { name: process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME }
  : undefined;
