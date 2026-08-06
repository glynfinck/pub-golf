/**
 * The local stack's coordinates. Shared by the Vitest `db` project and the
 * Playwright suite, so there is one place that explains what is missing.
 *
 * Deliberately free of any `vitest` import: e2e/auth.ts pulls this in too, and
 * a Playwright process must never load a test runner.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is missing. Run \`supabase start\` and make sure .env.local ` +
        "carries NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and " +
        "SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return value;
}

export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
export const ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
export const SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
