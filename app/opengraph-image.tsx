import { ImageResponse } from "next/og";

import { APP_NAME, FLAGSHIP_GAME, TAGLINE } from "@/lib/config";
import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgCard,
  loadOgFonts,
  ogMeta,
} from "@/lib/og";

export const alt = `${APP_NAME} — ${FLAGSHIP_GAME}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  const fonts = await loadOgFonts();

  return new ImageResponse(
    <OgCard
      eyebrow={FLAGSHIP_GAME}
      title={TAGLINE}
      titleSize={68}
      // Says what the thing is to someone who has only ever seen the link.
      meta={ogMeta("Host a round", "guests join with a code")}
    />,
    { ...size, fonts },
  );
}
