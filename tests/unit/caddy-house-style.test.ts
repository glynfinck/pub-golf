import { readdirSync, readFileSync } from "node:fs";
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
  "components/course/caddy-ask.tsx",
  "components/course/caddy-fee-panels.tsx",
  "components/course/caddy-gallery.tsx",
  "components/course/caddy-waiting.tsx",
  "components/course/course-room.tsx",
  "components/course/draw-walk-sheet.tsx",
  "components/course/retracting-panel.tsx",
  "components/course/stage-bar.tsx",
  "components/ui/chip.tsx",
  "components/ui/form-row.tsx",
  "components/ui/picker-row.tsx",
  "components/ui/slider.tsx",
  "components/ui/tee-time.tsx",
  "components/ui/toggle-group.tsx",
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

  /**
   * The floor is two dimensions, and only one of them is a class.
   *
   * The Holes control shipped 44px tall and **23px wide** — a sliver nothing
   * could be pressed on — because `w-full` inside a shrink-to-fit flex item
   * has no percentage to resolve against and collapses to content width. No
   * height class was wrong, so the sweep above saw nothing.
   *
   * A width cannot be measured by reading source, but the thing that *causes*
   * it can be named: an inline control sits in a slot with a definite minimum,
   * or it shrink-wraps. That is one line in one file, so it is assertable.
   */
  it("gives an inline control a slot wide enough to divide", () => {
    const row = read("components/ui/form-row.tsx");
    expect(row).toMatch(/min-w-45/);
    // 180px, not 176: four 44px segments plus the three hairlines between them
    // is 179, so a slot sized to 4×44 lands at 43.25 — under the floor by the
    // width of its own borders.
    expect(45 * 4).toBeGreaterThanOrEqual(44 * 4 + 3);
  });

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

  it("collapses the body and never the handle", () => {
    // The cap used to sit on the whole panel with a hand-derived number for
    // the tab's height — so the one control that reopens the panel lived
    // inside the thing being clipped, and every change to it had to re-derive
    // that number or lose pixels off the bottom of the only way back in.
    const panel = read("components/course/retracting-panel.tsx");
    expect(panel).toContain("max-h-0");
    expect(panel).not.toMatch(/max-h-\[calc\(\d/);
    // And the map keeps a floor: at a flat 82dvh the panel took the screen on
    // the surface whose entire premise is the map.
    expect(panel).toContain("calc(100dvh-18rem)");
  });

  /**
   * The opening tag of a JSX element, braces balanced.
   *
   * Asserting on the *file* rather than the element is what let the bar end up
   * pinned to the bottom of the room with this suite green: the string was
   * present, just on the wrong element. A prop belongs to a tag, so the test
   * has to read a tag.
   */
  function openingTag(source: string, tag: string): string {
    const at = source.indexOf(`<${tag}`);
    if (at < 0) return "";
    let depth = 0;
    for (let i = at; i < source.length; i += 1) {
      const char = source[i];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) return source.slice(at, i + 1);
    }
    return "";
  }

  it("floats over the map rather than squeezing it", () => {
    // As a flex sibling the panel took its height *out* of the map, so opening
    // the drawer resized it — and a Google map keeps its centre through a
    // resize, so the ground re-framed: the walk slid up the glass and the pins
    // moved. Absolutely positioned, the map is one fixed canvas and the sheet
    // slides across it, which is the only arrangement where opening the drawer
    // moves nothing at all.
    for (const file of PANELLED) {
      const mount = openingTag(read(file), "RetractingPanel");
      expect(`${file}: ${mount.includes("absolute inset-x-0 bottom-0")}`).toBe(
        `${file}: true`,
      );
    }
  });

  it("leaves the bar at the top of the screen, in flow", () => {
    // It was briefly given the panel's own positioning and went to the bottom,
    // above the drawer, on the screen whose first act it names.
    for (const file of PANELLED) {
      const bar = openingTag(read(file), "StageBar");
      expect(`${file}: ${bar.length > 0}`).toBe(`${file}: true`);
      expect(`${file}: ${/absolute|fixed|bottom-/.test(bar)}`).toBe(
        `${file}: false`,
      );
    }
  });

  it("owns the body's padding so no stage can bring its own", () => {
    // The room brought `pt-2` and the gallery `pt-1`, so the first thing under
    // the slot bar sat four pixels from it on one screen and eight on the
    // other — and the waiting card had a different gap above than below.
    const panel = read("components/course/retracting-panel.tsx");
    expect(panel).toMatch(/gap-3 px-4 pt-3/);
    // And nothing the panel wraps re-states it.
    expect(read("components/course/brief-form.tsx")).not.toMatch(
      /"flex flex-col gap-3", "px-4/,
    );
  });

  it("says the same three things at every act", () => {
    // The complaint this answers: five different wordings and a flipping
    // chevron on the control a host reaches for most. The figures come from
    // one pure function and the icons are fixed, so the furniture cannot
    // change shape with the stage again.
    const panel = read("components/course/retracting-panel.tsx");
    expect(panel).toContain("panelSlots");
    for (const icon of ["Flag", "Route", "Clock"]) {
      expect(`${icon}: ${panel.includes(`<${icon} `)}`).toBe(`${icon}: true`);
    }
    // And no stage-dependent label prop: the tab took one, which is how five
    // wordings got in. (`aria-label` stays — that is the button's name, and it
    // says only whether the panel is up.)
    expect(panel).not.toContain("jobPanelLabel");
    expect(panel).not.toMatch(/^\s*label\??:/m);
  });
});

describe("the brief's rhythm", () => {
  const BRIEF = read("components/course/brief-form.tsx");
  const ROW = read("components/ui/form-row.tsx");

  it("is one list, not four titled sections", () => {
    // Four eyebrow headings and four printed double rules over nine labelled
    // rows is more furniture than the thing it organises, and it made the
    // vertical spacing a different size at every boundary. The rows carry
    // their own names and the sentence above says the whole of it back.
    expect(BRIEF).not.toContain("BriefSection");
    expect(BRIEF).not.toContain("RuleDouble");
    expect((BRIEF.match(/<FormRows>/g) ?? []).length).toBe(1);
  });

  it("gives every row the same padding, whatever it holds", () => {
    // One `py` in one place. A stacked row is taller because its content is
    // taller — never because it is spaced differently.
    const frames = ROW.match(/py-[\d.]+/g) ?? [];
    expect(new Set(frames).size).toBe(1);
  });

  it("keeps explanation out of the left column", () => {
    // It made some rows two lines and others one, it truncated mid-word, and
    // it said what the value on the right of the same row already said. An
    // option's meaning belongs in the sheet where the option is chosen.
    expect(ROW).not.toMatch(/^\s*note\??:/m);
    expect(BRIEF).not.toMatch(/\bnote=\{/);
  });

  it("keeps a warning, because a warning is not an explanation", () => {
    // The thin-patch counter-offer says the answer will not work. That is the
    // one thing that may not be tucked into a sheet nobody opens.
    expect(ROW).toMatch(/warning\??:/);
    expect(BRIEF).toContain("warning=");
    expect(BRIEF).toContain("thinPatchNote");
  });
});

describe("Radix state variants", () => {
  /**
   * Tailwind ships `data-<value>:` shorthands for a fixed list of `data-state`
   * values, and **only** that list. Each of these was checked against the
   * compiled stylesheet: they expand to `[data-state=<value>]`, which is what
   * Radix actually sets.
   */
  const KNOWN = [
    "checked",
    "unchecked",
    "open",
    "closed",
    "disabled",
    "horizontal",
    "vertical",
  ];

  /**
   * The bug this exists to prevent, which cost two rounds to find.
   *
   * The segmented control styled its chosen state through a bare `data-on`
   * variant rather than `data-[state=on]`. `on` is not
   * on Tailwind's list, so it compiled to a bare `[data-on]` attribute
   * selector — an attribute Radix never sets. The selected segment took no
   * styling whatsoever: the control toggled correctly and looked identical
   * before and after, which is indistinguishable from a dead button. It was
   * reported, twice, as "can't click the holes buttons".
   *
   * Nothing catches this. It is not a type error, not a lint error, not a
   * runtime error, and the class is present in the stylesheet — it just never
   * matches. An unknown value has to be written `data-[state=on]:`, which
   * says what it means and cannot silently miss.
   */
  it("writes an unknown state as data-[state=…] rather than a bare variant", () => {
    const stray: string[] = [];
    for (const file of readdirSync(join(ROOT, "components/ui"))) {
      if (!file.endsWith(".tsx")) continue;
      const source = withoutComments(read(join("components/ui", file)));
      for (const [, value] of source.matchAll(/\bdata-([a-z][a-z-]*):/g)) {
        if (!KNOWN.includes(value)) stray.push(`${file}: data-${value}:`);
      }
    }
    expect(stray).toEqual([]);
  });

  it("styles the chosen segment on the attribute Radix sets", () => {
    // The positive half: the control must actually say `data-[state=on]`, so
    // deleting the highlight is a visible diff rather than a silent no-op.
    const group = read("components/ui/toggle-group.tsx");
    expect(group).toContain("data-[state=on]:bg-fairway");
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
