import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { APP_NAME } from "@/lib/config";

/**
 * Shared chrome for every generated Open Graph card.
 *
 * Satori supports only a subset of CSS and has no access to the Tailwind
 * tokens, so the palette below is a hand-kept mirror of the CREAM theme in
 * `app/globals.css`. Update both together.
 *
 * Cream, not the dark default: the recap card in
 * `components/round/recap-card.tsx` re-asserts `.theme-cream` whatever the app
 * is set to, because the thing you hand round is printed stock. A link preview
 * is the same object, so it gets the same paper.
 *
 * Satori cannot do `border-style: double`, `outline`, or `box-shadow: inset`,
 * which between them are the whole engraving kit — so the double rule is drawn
 * as two stacked divs and the medallion as two nested ones.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

export const ogColors = {
  background: "#f1edde",
  card: "#f7f4e9",
  foreground: "#23281e",
  muted: "#5a5f4e",
  fairway: "#1e4630",
  marker: "#c8802f",
  border: "#c9c3ac",
};

/**
 * The mark, as bytes Satori can draw.
 *
 * Vendored under `assets/` beside the fonts rather than read out of
 * `public/`: both are read off the filesystem at render time, and only
 * `assets/` is proven to survive into the serverless bundle — a card that
 * cannot find its own logo is a broken preview, and previews are the one
 * thing nobody sees fail until it is public. Cream-grounded, because these
 * cards always print on cream stock whatever the app theme is; on that
 * paper the plate disappears and leaves the drawing.
 *
 * Read once and held: the file never changes between requests.
 */
let ogMark: string | null = null;
export function ogMarkDataUri(): string {
  ogMark ??= `data:image/png;base64,${readFileSync(
    join(process.cwd(), "assets/og-mark.png"),
  ).toString("base64")}`;
  return ogMark;
}

/** EB Garamond stands in for the Palatino stack; JetBrains Mono for the
 * tabular figures. Satori needs real font data — a CSS stack means nothing to
 * it — so these are vendored under `assets/fonts/`. */
export async function loadOgFonts() {
  const [serif, serifSemi, serifItalic, mono] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/EBGaramond-Regular.ttf")),
    readFile(join(process.cwd(), "assets/fonts/EBGaramond-SemiBold.ttf")),
    readFile(join(process.cwd(), "assets/fonts/EBGaramond-Italic.ttf")),
    readFile(join(process.cwd(), "assets/fonts/JetBrainsMono-Medium.ttf")),
  ]);

  return [
    { name: "Garamond", data: serif, style: "normal" as const, weight: 400 as const },
    { name: "Garamond", data: serifSemi, style: "normal" as const, weight: 600 as const },
    { name: "Garamond", data: serifItalic, style: "italic" as const, weight: 400 as const },
    { name: "Mono", data: mono, style: "normal" as const, weight: 500 as const },
  ];
}

/**
 * Round names run from "Sat" to a full sentence, so step the size down as the
 * string grows. Satori does not fit text, and an overflowing title is clipped
 * rather than wrapped.
 */
export function titleFontSize(title: string): number {
  if (title.length <= 24) return 96;
  if (title.length <= 40) return 80;
  if (title.length <= 60) return 66;
  return 54;
}

/** Truncate on a word boundary so a name never ends mid-word. */
export function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

/** `a · b · c`, skipping anything empty. Satori has no `gap` on inline text. */
export function ogMeta(...parts: (string | number | null | undefined)[]): string {
  return parts.filter((part) => part !== null && part !== undefined && part !== "").join("  ·  ");
}

/** The thin-thick rule off the printed card. `border: double` is not a thing
 * Satori draws, so it is two divs. */
function DoubleRule() {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      <div style={{ height: 1, backgroundColor: ogColors.border }} />
      <div style={{ height: 3, marginTop: 3, backgroundColor: ogColors.border }} />
    </div>
  );
}

/**
 * The card body: cream stock, a double rule at the head, the mark and the
 * app name as a running head, then eyebrow → serif title → meta line.
 */
export function OgCard({
  eyebrow,
  title,
  meta,
  plate,
  titleSize,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
  /** The letterpress entry-code plate, when there is a code to show. */
  plate?: string;
  titleSize?: number;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "56px 72px",
        backgroundColor: ogColors.background,
        color: ogColors.foreground,
        fontFamily: "Garamond",
      }}
    >
      <DoubleRule />

      {/* Running head: the mark, then the house name. */}
      <div style={{ display: "flex", alignItems: "center", marginTop: 28 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ogMarkDataUri()} width={46} height={46} alt="" />
        <div
          style={{
            marginLeft: 16,
            fontFamily: "Mono",
            fontSize: 22,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: ogColors.fairway,
          }}
        >
          {APP_NAME}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flex: 1,
        }}
      >
        <div
          style={{
            fontFamily: "Mono",
            fontSize: 24,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: ogColors.marker,
          }}
        >
          {eyebrow}
        </div>

        <div
          style={{
            marginTop: 18,
            maxWidth: 1000,
            fontSize: titleSize ?? titleFontSize(title),
            fontStyle: "italic",
            lineHeight: 1.08,
            color: ogColors.foreground,
          }}
        >
          {title}
        </div>

        {plate ? (
          <div style={{ display: "flex", marginTop: 34 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "14px 34px 18px",
                backgroundColor: ogColors.card,
                border: `2px solid ${ogColors.foreground}`,
                borderRadius: 14,
              }}
            >
              <div
                style={{
                  fontFamily: "Mono",
                  fontSize: 17,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  color: ogColors.muted,
                }}
              >
                Entry code
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: "Mono",
                  fontSize: 58,
                  letterSpacing: "0.26em",
                  // The tracking is applied on the right of every character,
                  // including the last — nudge back so the plate reads centred.
                  marginRight: -15,
                  color: ogColors.foreground,
                }}
              >
                {plate}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {meta ? (
        <div
          style={{
            display: "flex",
            fontFamily: "Mono",
            fontSize: 24,
            color: ogColors.muted,
          }}
        >
          {meta}
        </div>
      ) : null}
    </div>
  );
}
