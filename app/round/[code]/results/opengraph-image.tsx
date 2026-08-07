import { ImageResponse } from "next/og";

import { getRoundCard } from "@/lib/data/round-card";
import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgCard,
  clamp,
  loadOgFonts,
  ogMeta,
} from "@/lib/og";

export const alt = "The card, filed";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * The recap card.
 *
 * No names and no scores, deliberately — the results page redirects a
 * signed-out visitor, and the preview must not hand out what the page will
 * not. The round, its size, and the date it was played; who won is for the
 * people who open it.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const [round, fonts] = await Promise.all([
    getRoundCard(code.toUpperCase()),
    loadOgFonts(),
  ]);

  if (!round) {
    return new ImageResponse(
      <OgCard eyebrow="The 19th hole" title="No card under that code" />,
      { ...size, fonts },
    );
  }

  const played = new Date(round.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return new ImageResponse(
    <OgCard
      eyebrow="The 19th hole"
      title={clamp(round.name, 70)}
      meta={ogMeta(
        played,
        `${round.holeCount} ${round.holeCount === 1 ? "hole" : "holes"}`,
        `par ${round.par}`,
        round.status === "finished" ? "final card" : null,
      )}
    />,
    { ...size, fonts },
  );
}
