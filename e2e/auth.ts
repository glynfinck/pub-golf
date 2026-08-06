import type { BrowserContext } from "@playwright/test";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = "http://localhost:3105";

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error(
    "E2E needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and " +
      "SUPABASE_SERVICE_ROLE_KEY in .env.local (run `supabase start`).",
  );
}

/** Local-only, and never a real credential — these users exist for one run. */
const PASSWORD = "e2e-not-a-secret-password";

/**
 * Put a signed-in host into `context`.
 *
 * Production sign-in is Google-only, and a Google consent screen cannot be
 * driven from CI, so the session is minted out of band instead: create a
 * confirmed user with the admin API, sign in for real tokens, then hand the
 * resulting cookies to the browser.
 *
 * The cookies are serialized by @supabase/ssr itself against an in-memory jar
 * rather than hand-rolled, so their names, chunking and encoding always match
 * whatever the app's own client expects to read back.
 */
export async function signInAs(
  context: BrowserContext,
  { email, name }: { email: string; name: string },
) {
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (createError && !/already|registered|exists/i.test(createError.message)) {
    throw createError;
  }

  const jar = new Map<string, string>();
  const client = createBrowserClient(SUPABASE_URL!, ANON_KEY!, {
    isSingleton: false,
    cookies: {
      getAll: () =>
        [...jar].map(([cookieName, value]) => ({ name: cookieName, value })),
      setAll: (cookies) => {
        for (const { name: cookieName, value } of cookies) {
          jar.set(cookieName, value);
        }
      },
    },
  });

  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;
  if (jar.size === 0) {
    throw new Error("Sign-in produced no session cookies for the browser.");
  }

  await context.addCookies(
    [...jar].map(([cookieName, value]) => ({
      name: cookieName,
      value,
      url: BASE_URL,
    })),
  );
}
