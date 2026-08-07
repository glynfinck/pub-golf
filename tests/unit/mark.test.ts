import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { markColors, markSvg } from "@/lib/mark";

/**
 * The mark has one definition in `lib/mark.ts`, and every consumer imports it
 * — except `app/icon.svg`, which is a static file Next serves as the favicon
 * and cannot import anything. That copy is pinned here instead: if the mark
 * moves and the file does not, this fails rather than the two quietly
 * disagreeing about what the app looks like.
 */
describe("the house mark", () => {
  it("is the same drawing in app/icon.svg as in lib/mark.ts", () => {
    const onDisk = readFileSync(
      join(process.cwd(), "app/icon.svg"),
      "utf8",
    ).trim();
    expect(onDisk).toBe(markSvg(32));
  });

  it("draws the plate only when asked for one", () => {
    // On a card that already has cream stock under it, a dark rounded square
    // would be a sticker rather than a mark.
    expect(markSvg(46, { plate: true })).toContain("<rect");
    expect(markSvg(46, { plate: false })).not.toContain("<rect");
  });

  it("inks light on the plate and dark on the stock", () => {
    const light = markSvg(46, { ink: "light" });
    expect(light).toContain(markColors.stick);
    expect(light).toContain(markColors.green);

    const dark = markSvg(46, { ink: "dark" });
    expect(dark).toContain(markColors.inkDark);
    expect(dark).not.toContain(markColors.stick);
  });

  it("keeps the pennant in marker orange whichever way the ink runs", () => {
    // The one colour that scores, in the app and on the card alike.
    for (const ink of ["light", "dark"] as const) {
      expect(markSvg(46, { ink })).toContain(markColors.pennant);
    }
  });

  it("scales by attribute, not by redrawing", () => {
    // The viewBox is fixed so every consumer gets identical geometry; only the
    // rendered box changes.
    expect(markSvg(180)).toContain('width="180" height="180"');
    expect(markSvg(180)).toContain('viewBox="0 0 32 32"');
  });
});
