import type { MetadataRoute } from "next";

import { APP_NAME, FLAGSHIP_GAME, TAGLINE } from "@/lib/config";

/**
 * Finishes the PWA intent already declared in `app/layout.tsx` — `appleWebApp`
 * and the light/dark `themeColor` pair were there before an icon existed to go
 * with them. Dark is the house skin, so the standalone window opens on the
 * Midnight Invitational rather than flashing cream first.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // The app and its game share a name now, so pairing them here would
    // install "Pub Golf — Pub Golf" on somebody's home screen.
    name: APP_NAME === FLAGSHIP_GAME ? APP_NAME : `${APP_NAME} — ${FLAGSHIP_GAME}`,
    short_name: APP_NAME,
    description: TAGLINE,
    // The install's identity, and the reason to set it explicitly: without
    // `id` the browser keys the install on `start_url`, so the day that
    // changes, an existing home-screen icon becomes a *second* app rather
    // than an update.
    id: "/",
    start_url: "/",
    scope: "/",
    lang: "en-GB",
    dir: "ltr",
    // A scorecard held in one hand. Nothing in the app has a landscape
    // layout — every screen is the max-w-md column.
    orientation: "portrait",
    categories: ["games", "sports", "social"],
    display: "standalone",
    background_color: "#101b13",
    theme_color: "#101b13",
    // "/apple-icon" was the generated route's URL; the icon is a static
    // file now, so the path carries its extension or the install 404s.
    icons: [
      { src: "/favicon.ico", type: "image/x-icon", sizes: "16x16 32x32 48x48" },
      { src: "/apple-icon.png", type: "image/png", sizes: "180x180" },
      { src: "/brand/icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/brand/icon-512.png", type: "image/png", sizes: "512x512" },
      // Android masks the icon into the launcher's own shape. Without a
      // maskable entry every icon above is treated as `purpose: "any"` and
      // gets letterboxed — the whole squircle shrunk inside a circle.
      // `scripts/brand-maskable.mjs` writes this one; it is the same plate
      // bled to the edges with the glass pulled inside the safe zone.
      {
        src: "/brand/icon-maskable-512.png",
        type: "image/png",
        sizes: "512x512",
        purpose: "maskable",
      },
    ],
  };
}
