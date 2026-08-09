import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and images. The session
     * only needs refreshing on paths that can read it.
     *
     * `manifest.webmanifest` is named because its extension is not in the
     * list below: without it, every install prompt and every PWA cold start
     * spent a Supabase token refresh on a file that has never read a
     * session. (robots.txt and sitemap.xml were already covered by `txt|xml`.)
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
