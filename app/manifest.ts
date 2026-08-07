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
    name: `${APP_NAME} — ${FLAGSHIP_GAME}`,
    short_name: APP_NAME,
    description: TAGLINE,
    start_url: "/",
    display: "standalone",
    background_color: "#101b13",
    theme_color: "#101b13",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };
}
