/**
 * The Parlour mark: a pennant on a flagstick, planted on the green.
 *
 * One definition, three consumers — the favicon (`app/icon.svg`), the
 * generated images (`app/apple-icon.tsx` and the Open Graph cards, which take
 * the markup as a data URI), and the sign-in screen (`ParlourMark`). Satori
 * cannot resolve `var(--marker)` and neither can an icon file, so the colours
 * are literals here rather than tokens; they are the dark theme's values from
 * `app/globals.css` and have to move with it.
 *
 * `app/icon.svg` is a static file and so is the one copy that cannot import
 * this — `tests/unit/mark.test.ts` pins it to `markSvg(32)` instead.
 */

export const MARK_VIEWBOX = 32;

/** Dark-theme values, mirrored from `app/globals.css`. */
export const markColors = {
  /** The plate the mark sits on — reads against light and dark browser chrome. */
  background: "#101b13",
  /** The stick, in cream so it holds up against the plate at 16px. */
  stick: "#eae5d2",
  /** The pennant: --marker, the one colour that scores. */
  pennant: "#d99443",
  /** The green: --fairway. */
  green: "#7fb08d",
  /** The cream theme's --fairway, for the mark inked onto printed stock. */
  inkDark: "#1e4630",
} as const;

/**
 * Weights are set for 16px, not for the poster.
 *
 * At a browser tab's smallest size the whole mark is 16 device pixels, so a
 * 2-unit stroke in this 32-unit box lands on one. Everything below is a shade
 * heavier than looks right at 128px, and the pennant is deliberately oversized
 * against the stick — at 16px the flag is the only part still legible, and it
 * is what makes the mark read as golf rather than as a lamp post.
 */

/** The flagstick, drawn as a path so a plain SVG string can carry it. */
export const STICK_PATH = "M12 6 L12 24";
/** The pennant, flying right off the top of the stick. */
export const PENNANT_PATH = "M12 6.1 L25 10 L12 13.9 Z";
/** The green, in perspective — a flattened ellipse the stick stands in. */
export const GREEN = { cx: 16, cy: 24.2, rx: 8.4, ry: 2.6 } as const;
/** Stroke weights, shared so the React mark matches the generated ones. */
export const STICK_WIDTH = 2.8;
export const GREEN_WIDTH = 2.4;

export interface MarkOptions {
  /** Draw the rounded background square. Off when the caller supplies its own
   * background — an Open Graph card already on cream stock, or the apple icon
   * whose container is the plate. */
  plate?: boolean;
  /** Which way round the ink runs. "light" is the stick and green on a dark
   * plate; "dark" is the same mark inked onto cream. Independent of `plate`:
   * the apple icon wants light ink with no rect of its own. */
  ink?: "light" | "dark";
}

/** The mark as standalone SVG markup. */
export function markSvg(
  size: number,
  { plate = true, ink = "light" }: MarkOptions = {},
): string {
  const v = MARK_VIEWBOX;
  // The pennant is --marker either way; it is the one colour that scores.
  const stick = ink === "light" ? markColors.stick : markColors.inkDark;
  const green = ink === "light" ? markColors.green : markColors.inkDark;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${v} ${v}">`,
    plate
      ? `<rect width="${v}" height="${v}" rx="7" fill="${markColors.background}"/>`
      : "",
    `<ellipse cx="${GREEN.cx}" cy="${GREEN.cy}" rx="${GREEN.rx}" ry="${GREEN.ry}" fill="none" stroke="${green}" stroke-width="${GREEN_WIDTH}"/>`,
    `<path d="${STICK_PATH}" fill="none" stroke="${stick}" stroke-width="${STICK_WIDTH}" stroke-linecap="round"/>`,
    `<path d="${PENNANT_PATH}" fill="${markColors.pennant}"/>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("");
}

/** The mark as a data URI, for `<img>` inside an ImageResponse. */
export function markDataUri(size: number, options?: MarkOptions): string {
  return `data:image/svg+xml,${encodeURIComponent(markSvg(size, options))}`;
}
