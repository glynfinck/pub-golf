import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { cookieOptions } from "@/lib/supabase/cookie";

/**
 * Refreshes the auth session on every matched request and keeps the cookies
 * in sync between the request and response. Authoritative access control
 * lives in RLS; this only keeps sessions fresh.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // The third factory, and the one easiest to forget: missing it here
      // means the middleware refreshes a cookie nothing else reads.
      cookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between client creation and getUser() —
  // it refreshes the session token.
  await supabase.auth.getUser();

  return supabaseResponse;
}
