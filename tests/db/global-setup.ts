import { createClient } from "@supabase/supabase-js";

/**
 * One clear error when the stack is down, instead of N opaque ECONNREFUSEDs
 * from N test files.
 */
export default async function setup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anon || !service) {
    throw new Error(
      "Database tests need NEXT_PUBLIC_SUPABASE_URL, " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in " +
        ".env.local — run `supabase start`.",
    );
  }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.from("game_types").select("id").limit(1);
  if (error) {
    throw new Error(
      `Local Supabase is not answering at ${url} (${error.message}). Run ` +
        "`supabase start`, then `supabase db reset` if migrations have moved.",
    );
  }
}
