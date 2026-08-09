import { NextResponse } from "next/server";

import { safeNext } from "@/lib/auth-paths";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback: exchanges the PKCE code for a session, then redirects.
 *
 * Serves both entry points — the host signing in at /signin, and a guest
 * linking Google to their anonymous card from the results screen. Both are
 * the same exchange; only `next` differs.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Only same-site relative redirect targets; the rule lives in one place
  // because three hops read this value (see lib/auth-paths.ts).
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/signin?error=auth`);
}
