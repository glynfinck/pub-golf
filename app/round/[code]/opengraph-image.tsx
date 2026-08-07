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

export const alt = "You're invited to a round";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * The card that lands in the group chat.
 *
 * The lobby's share button sends exactly this URL, so this is the one preview
 * that carries real weight — it has to say what the round is and show the code
 * without the reader opening anything.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = code.toUpperCase();
  const [round, fonts] = await Promise.all([
    getRoundCard(normalized),
    loadOgFonts(),
  ]);

  // A code that does not resolve still has to return an image: this route is
  // generated independently of the page, so throwing would surface as a broken
  // card rather than a 404.
  if (!round) {
    return new ImageResponse(
      <OgCard
        eyebrow="Pub Golf"
        title="This round has closed its card"
        meta="pub golf"
      />,
      { ...size, fonts },
    );
  }

  return new ImageResponse(
    <OgCard
      eyebrow={round.status === "lobby" ? "You're invited" : "Round in play"}
      title={clamp(round.name, 70)}
      plate={normalized}
      meta={ogMeta(
        `${round.holeCount} ${round.holeCount === 1 ? "hole" : "holes"}`,
        `par ${round.par}`,
        "lowest swigs wins",
      )}
    />,
    { ...size, fonts },
  );
}
