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
    start_url: "/",
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
    ],
  };
}
