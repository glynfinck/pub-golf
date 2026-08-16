import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The caddy's surfaces, held to the house's own scale.
 *
 * These files invented a private one: eleven distinct font sizes across seven
 * files and **zero** uses of `text-sm`, the size the rest of the app renders
 * body copy at — so the caddy set body copy at 11px and decorated the gap with
 * one-offs (`text-[11.5px]`, `text-[13px]`, `text-[15px]`). Tap targets drifted
 * the same way: chips at 40px, the stage rail at 36, a dismiss at 32, against a
 * documented 44px minimum.
 *
 * Nothing about that is catchable by reading a diff, and it is exactly the kind
 * of thing that creeps back one hurried class at a time. So it is a test, in
 * the tier that can hold it — the same shape as
 * `tests/unit/covenant-money.test.ts`, which guards a rule about *where* a
 * price may appear by reading the source rather than by trusting a convention.
 *
 * **This is a floor, not a straitjacket.** Adding a size to `SCALE` is a
 * deliberate act with a diff attached, which is the whole point: the last one
 * arrived without one.
 */

const ROOT = join(import.meta.dirname, "..", "..");

/** Every surface the caddy flow renders, plus the two primitives it leans on
 * hardest. A new file in this flow belongs on this list. */
const SURFACES = [
  "components/course/brief-form.tsx",
  "components/course/brief-parts.tsx",
  "components/course/caddy-ask.tsx",
  "components/course/caddy-fee-panels.tsx",
  "components/course/caddy-gallery.tsx",
  "components/course/caddy-waiting.tsx",
  "components/course/course-room.tsx",
  "components/course/draw-walk-sheet.tsx",
  "components/course/retracting-panel.tsx",
  "components/course/stage-bar.tsx",
  "components/ui/chip.tsx",
  "components/ui/tee-time.tsx",
];

/**
 * The six the caddy is allowed.
 *
 * `text-[10px]` and `text-[11px]` are the dense workhorses these screens are
 * built from; `text-xs` is chip text; `text-sm` is body; the serif steps are
 * headings and the card's name. Anything else is a one-off.
 */
const SCALE = new Set([
  "text-[10px]",
  "text-[11px]",
  "text-xs",
  "text-sm",
  "text-base",
  "text-lg",
  "text-xl",
  // `HazardPill` owns 9px and is the only thing that may.
  "text-[9px]",
]);

function read(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

/** Class strings only — a size named inside a comment is prose, not a style. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("the caddy's type scale", () => {
  it("uses only the six sizes the house sanctions", () => {
    const strays: string[] = [];
    for (const file of SURFACES) {
      const found =
        withoutComments(read(file)).match(
          /text-\[[0-9.]+px\]|text-(?:xs|sm|base|lg|xl|2xl)\b/g,
        ) ?? [];
      for (const size of found) {
        if (!SCALE.has(size)) strays.push(`${file}: ${size}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it("keeps the tail it deleted deleted", () => {
    // The four that were there, each now folded onto its nearest step. Named
    // individually so a regression says which one came back.
    for (const gone of [
      "text-[11.5px]",
      "text-[12px]",
      "text-[13px]",
      "text-[15px]",
    ]) {
      for (const file of SURFACES) {
        expect(`${file}: ${withoutComments(read(file)).includes(gone)}`).toBe(
          `${file}: false`,
        );
      }
    }
  });
});

describe("the caddy's tap targets", () => {
  /**
   * The heights that are too small to land a thumb on.
   *
   * CLAUDE.md sets the floor at 44px and the Button default at 48. These are
   * the Tailwind steps below it, which is what every one of the nine drifted
   * controls was written in.
   */
  const TOO_SMALL = /\b(?:min-h|h|size)-(?:6|7|8|9|10)\b/g;

  /**
   * The only small boxes in this set that are not targets, each with its
   * reason. A number here has to be argued for, which is the point — the
   * nine controls that drifted below the floor all did so silently.
   *
   * `caddy-waiting` — a layout box reserving the two clamped rows under the
   *   ticker's heading, so nothing beneath it moves as the narration arrives.
   *   It never receives a tap.
   * `caddy-gallery` — the numbered map pins. Twenty-four pixels of *ink*
   *   inside a 44px wrapper: a pin any bigger would cover the walk it marks,
   *   so the paint stays small and the hit area is the thing that grew.
   */
  const ALLOWED = new Map([
    ["components/course/caddy-waiting.tsx", 1],
    ["components/course/caddy-gallery.tsx", 2],
  ]);

  it("has nothing a thumb can miss", () => {
    const small: string[] = [];
    for (const file of SURFACES) {
      const hits = withoutComments(read(file)).match(TOO_SMALL) ?? [];
      const allowance = ALLOWED.get(file) ?? 0;
      if (hits.length > allowance) {
        small.push(`${file}: ${hits.join(", ")} (allowed ${allowance})`);
      }
    }
    expect(small).toEqual([]);
  });
});

describe("the panel under a map", () => {
  /** Both screens that stand furniture under a full-bleed map. */
  const PANELLED = [
    "components/course/course-room.tsx",
    "components/course/caddy-gallery.tsx",
  ];

  it("is the same panel on both screens", () => {
    // The gallery's bottom half was a second implementation of the room's
    // brief panel — same job, different retraction, different tab. Two copies
    // of a behaviour drift apart the first time one is touched, and these two
    // are read one after the other in the same flow, so the drift shows.
    for (const file of PANELLED) {
      expect(`${file}: ${read(file).includes("<RetractingPanel")}`).toBe(
        `${file}: true`,
      );
    }
  });

  it("caps the collapsed panel at the tab it is measuring", () => {
    // Tailwind's preflight makes this a border-box, so the cap has to cover
    // the border too — a bare 2.75rem ate a pixel of the 44px button that is
    // the only way back into the panel.
    const panel = read("components/course/retracting-panel.tsx");
    expect(panel).toContain("max-h-[calc(2.75rem+1px)]");
    // And the map keeps a floor: at a flat 82dvh the panel took the screen on
    // the surface whose entire premise is the map.
    expect(panel).toContain("calc(100dvh-15rem)");
  });
});

describe("the caddy's colours", () => {
  it("names them through the house's tokens, never in hex", () => {
    const raw: string[] = [];
    for (const file of SURFACES) {
      // Google's Maps API takes a colour *string*, not a CSS custom property,
      // so the dotted-walk symbol is the one place a literal is unavoidable.
      // It is scoped to that call and reads both themes from `dark`.
      const source = withoutComments(read(file)).replace(
        /fillColor: dark \? "#[0-9a-f]{6}" : "#[0-9a-f]{6}"/gi,
        "",
      );
      const found = source.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
      if (found.length) raw.push(`${file}: ${found.join(", ")}`);
    }
    expect(raw).toEqual([]);
  });
});
