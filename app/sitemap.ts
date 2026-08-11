import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/config";

/**
 * Five URLs, which is genuinely all of it. Everything else in the app is
 * behind a session or keyed by a round code: the clubhouse tabs redirect a
 * signed-out visitor to /signin, and a round is only reachable by someone
 * holding its code.
 *
 * No `lastModified` — these pages change when somebody edits them, and a
 * build timestamp would tell a crawler they change on every deploy.
 */
const PAGES = ["/", "/join", "/signin", "/legal/privacy", "/legal/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((path) => ({
    url: new URL(path, SITE_URL).toString(),
    changeFrequency: "monthly" as const,
    priority: path === "/" ? 1 : 0.5,
  }));
}
