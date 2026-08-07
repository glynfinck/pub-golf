/**
 * The local stack's coordinates. Shared by the Vitest `db` project and the
 * Playwright suite, so there is one place that explains what is missing.
 *
 * Deliberately free of any `vitest` import: e2e/auth.ts pulls this in too, and
 * a Playwright process must never load a test runner.
 */
/**
 * "null" counts as missing. `.env.local` is written by piping
 * `supabase status -o json` through `jq -r`, which prints the four characters
 * `null` for a field that isn't there — so a key that failed to resolve
 * arrives as a perfectly truthy string and sails through a bare `if (!value)`.
 * The client then talks to PostgREST with a nonsense key and the failure
 * resurfaces much later wearing someone else's face.
 */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value === "null" || value === "undefined") {
    throw new Error(
      `${name} is ${value ? `the literal string "${value}"` : "missing"}. ` +
        "Run `supabase start` and make sure .env.local carries " +
        "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and " +
        "SUPABASE_SERVICE_ROLE_KEY with real values.",
    );
  }
  return value;
}

export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
export const ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
export const SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
