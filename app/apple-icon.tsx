import { ImageResponse } from "next/og";

import { markColors, markDataUri } from "@/lib/mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * The home-screen icon. Same mark as `app/icon.svg`, but iOS rounds the corners
 * itself and crops tighter than a browser tab, so the plate is drawn flat to
 * the edges and the mark is given room inside it.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: markColors.background,
        }}
      >
        <img
          src={markDataUri(124, { plate: false, ink: "light" })}
          width={124}
          height={124}
          alt=""
        />
      </div>
    ),
    size,
  );
}
