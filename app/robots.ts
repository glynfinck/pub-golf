import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/config";

/**
 * Note what is *not* disallowed: `/round/`.
 *
 * Blocking it looks right — those pages redirect a signed-out visitor and
 * hold nothing a crawler should have — but the Open Graph cards are served
 * from inside that tree (`/round/CODE/opengraph-image`), and the stricter
 * unfurlers read robots.txt before they fetch one. A Disallow there trades a
 * crawl nobody minds for the link previews the whole share flow rests on.
 *
 * The round routes are already safe without it: `get_round_card` is the
 * public path and it hands out no names and no scores by design.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Neither is a page: one is the app's own fetch surface, the other is
      // the OAuth code exchange, which is single-use and origin-bound.
      disallow: ["/api/", "/auth/"],
    },
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
  };
}
