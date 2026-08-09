/**
 * Where sign-in sends people, and where it is allowed to send them back to.
 *
 * `next` travels a long way: a protected page redirects to `/signin?next=…`,
 * the sign-in screen hands it to `signInWithOAuth` as
 * `/auth/callback?next=…`, Google bounces through Supabase, and the callback
 * finally redirects to it. Three of those hops read the value, and until this
 * module existed two of them carried their own copy of the same rule.
 *
 * One copy, because it is the rule that stops the parameter being an open
 * redirect: anything that is not a same-site absolute path is discarded
 * rather than corrected. `//evil.example` is the case worth naming — it looks
 * relative, and a browser reads it as protocol-relative, so `startsWith("/")`
 * alone is not enough.
 */

/** The sign-in screen itself, for the callers with nowhere to come back to. */
export const SIGN_IN = "/signin";

/**
 * The redirect target, or "/" when the value cannot be trusted.
 *
 * Deliberately not a throw and not a 400: a mangled `next` is somebody's
 * stale bookmark far more often than it is an attack, and the honest answer
 * to both is the clubhouse.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  // Protocol-relative (`//host`) and backslash variants leave the site.
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

/**
 * `/signin`, carrying where to return to.
 *
 * Only worth a parameter when there is somewhere to go back to — signing in
 * on the way to `/` is just signing in, so the bare path stays bare rather
 * than growing a `?next=%2F` nobody needs to read.
 */
export function signInPath(next?: string | null): string {
  const target = safeNext(next);
  if (target === "/") return SIGN_IN;
  return `${SIGN_IN}?next=${encodeURIComponent(target)}`;
}
