import { haversineKm, WALK_MINUTES_PER_KM } from "@/lib/geo";

/**
 * The three figures under the drawer's handle.
 *
 * **The rule: three slots, three icons, forever — only the figures move.** The
 * tab used to be a line of text that changed at every act: "The brief", "The
 * brief · walk drawn", "The walks · the long way", "Dressing the card", "The
 * card · 9 holes". Five wordings, five widths, and a chevron that flipped, so
 * the one piece of furniture a host reaches for most was different every time
 * they looked at it. There was nothing constant to aim a thumb at.
 *
 * Fixed slots invert that: the shape and the icons never change, so the eye
 * stops re-reading the furniture and only reads the numbers. Retracted, the
 * panel is still a status bar — which is what the changing text was trying and
 * failing to be.
 *
 * Pure, because "what does the tab say" is arithmetic over three numbers and
 * belongs in the tier that can prove it.
 */
export interface PanelSlots {
  /** How many stops the walk has. */
  holes: string;
  /** How far it is on the ground. */
  walk: string;
  /** How long it takes, walking and drinking. */
  time: string;
}

/**
 * The em dash is the empty slot, deliberately.
 *
 * A blank would collapse the row's height before there is a walk, and the
 * whole point of fixed slots is that the furniture does not move. A dash says
 * "this figure exists and is not known yet", which is true.
 */
export const NO_FIGURE = "—";

/** Roughly how long a hole takes once you are inside it: order, drink, move
 * on. The walk is the part this file can compute exactly; the sitting is a
 * house constant, and it is the larger half of a night. */
export const MINUTES_PER_HOLE = 8;

export function panelSlots({
  holes,
  km,
}: {
  /** Stops on the walk, or null before there is one. */
  holes: number | null;
  /** Total walking distance, or null before there is one. */
  km: number | null;
}): PanelSlots {
  return {
    holes: holes == null ? NO_FIGURE : `${holes} holes`,
    walk: km == null ? NO_FIGURE : `${km.toFixed(1)} km`,
    // Both halves or neither: a time built from the walk alone would read as
    // the length of the night, and it is a fifth of it.
    time:
      holes == null || km == null
        ? NO_FIGURE
        : `${Math.round(km * WALK_MINUTES_PER_KM + holes * MINUTES_PER_HOLE)} min`,
  };
}

/**
 * How far a walk is, from the stops themselves.
 *
 * Straight lines between pubs, which under-reads the streets — the same
 * approximation the router plans on, so the panel agrees with the menu that
 * produced it rather than quietly disagreeing by a few hundred metres.
 * A stop with no coordinates breaks the chain rather than teleporting through
 * it: the leg either side of it is skipped, not measured to null island.
 */
export function walkKmOf(
  stops: { lat: number | null; lng: number | null }[],
): number | null {
  let km = 0;
  let measured = 0;
  for (let i = 1; i < stops.length; i += 1) {
    const from = stops[i - 1];
    const to = stops[i];
    if (from.lat == null || from.lng == null) continue;
    if (to.lat == null || to.lng == null) continue;
    km += haversineKm(from.lat, from.lng, to.lat, to.lng);
    measured += 1;
  }
  // Nothing measurable is not the same as nothing walked, and a confident
  // "0.0 km" over a card whose pubs have no coordinates would be a lie.
  return measured === 0 ? null : km;
}
