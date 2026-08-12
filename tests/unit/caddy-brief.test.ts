import { describe, expect, it } from "vitest";

import {
  paceForReach,
  paceNote,
  readBrief,
  stretchWarning,
} from "@/lib/caddy/brief";


describe("a night that goes somewhere", () => {
  it("carries a second area", () => {
    const brief = readBrief({
      where: "Finsbury Park",
      whereTo: "Broadway Market",
      holes: 9,
      vibe: "traditional",
      particulars: [],
      note: "",
      stretch: 8,
    });
    expect(brief?.where).toBe("Finsbury Park");
    expect(brief?.whereTo).toBe("Broadway Market");
  });

  it("treats the same area twice as one patch", () => {
    // A host who picks their own area for both ends wants a tight round, not a
    // walk back to where they began. Case-insensitively, because the two
    // fields are typed separately.
    const brief = readBrief({
      where: "Shoreditch",
      whereTo: "shoreditch",
      holes: 9,
      vibe: "traditional",
      particulars: [],
      note: "",
      stretch: 8,
    });
    expect(brief?.whereTo).toBe("");
  });

  it("defaults to one patch when no destination is given", () => {
    const brief = readBrief({ where: "Soho", holes: 9, vibe: "traditional", particulars: [], note: "", stretch: 8 });
    expect(brief?.whereTo).toBe("");
  });
});

describe("stretchWarning", () => {
  it("warns before the fee is spent when the walk is a march", () => {
    // Finsbury Park to Broadway Market is about 4km. Over nine holes that is
    // half a kilometre a leg, which is a walk but a fair one.
    expect(stretchWarning(4, 9)).toBeNull();
    // The same two ends over four holes is well over a kilometre each, which
    // is a march between drinks and worth saying out loud.
    const warned = stretchWarning(4, 4);
    expect(warned).toMatch(/proper walk/);
    expect(warned).toContain("4.0km");
  });

  it("says when two areas are really one", () => {
    const warned = stretchWarning(0.4, 9);
    expect(warned).toMatch(/one patch/);
  });

  it("says nothing about an ordinary round", () => {
    // Most rounds. A warning on every plan is a warning nobody reads.
    expect(stretchWarning(2.5, 9)).toBeNull();
    expect(stretchWarning(0, 9)).toBeNull();
  });

  it("never divides by zero on a one-hole round", () => {
    expect(() => stretchWarning(3, 1)).not.toThrow();
  });
});

describe("a named finish sets the pace", () => {
  it("derives the pace from the distance and the hole count", () => {
    // Four kilometres over nine holes is eight legs of 500m, which at a stroll
    // is about seven minutes. The host does not choose this — the place they
    // named and the number of holes decide it between them.
    expect(paceForReach(4, 9)).toBe(7);
    // Same walk, fewer holes: longer legs. This is the lever a host actually
    // has, and it is why nothing is disabled on screen.
    expect(paceForReach(4, 5)).toBe(13);
  });

  it("reads the derived pace in the voice the chips use", () => {
    expect(paceNote(7)).toBe("About 7 minutes' walk between pubs.");
    expect(paceNote(1)).toBe("About a minute between pubs.");
    expect(paceNote(0)).toBe("Whatever's closest.");
  });

  it("carries a bounded reach and drops it for a single patch", () => {
    const far = readBrief({
      where: "Shoreditch",
      whereTo: "Covent Garden",
      reachKm: 4.2,
      holes: 9,
      vibe: "traditional",
      particulars: [],
      note: "",
      stretch: 5,
    });
    expect(far?.reachKm).toBeCloseTo(4.2, 5);

    // The same area twice is one patch, so the reach goes with the
    // destination rather than lingering as a distance to nowhere.
    const same = readBrief({
      where: "Shoreditch",
      whereTo: "shoreditch",
      reachKm: 4.2,
      holes: 9,
      vibe: "traditional",
      particulars: [],
      note: "",
      stretch: 5,
    });
    expect(same?.reachKm).toBe(0);
  });

  it("refuses a reach that is a typo or a joke", () => {
    const brief = (reachKm: unknown) =>
      readBrief({
        where: "Shoreditch",
        whereTo: "Tokyo",
        reachKm,
        holes: 9,
        vibe: "traditional",
        particulars: [],
        note: "",
        stretch: 5,
      });
    // It arrives from the browser, so it is a hint rather than a fact.
    expect(brief(9000)?.reachKm).toBe(40);
    expect(brief(-5)?.reachKm).toBe(0);
    expect(brief("far")?.reachKm).toBe(0);
    expect(brief(Number.NaN)?.reachKm).toBe(0);
  });
});

/**
 * The aim survives the parser.
 *
 * `openPlan` resolves both area centres and stamps them onto the session's
 * brief; every router downstream reads them. But `readBrief` built a fresh
 * object literal without the two keys, so all of them received `undefined`,
 * `nearestTo` never fired, and a round asked to finish in Covent Garden walked
 * wherever the candidate cloud happened to be widest.
 *
 * **`tests/unit/caddy-real-patches.test.ts` pins that behaviour hard, at real
 * coordinates, and passed throughout** — because it hands `aimFrom` straight to
 * `buildRouteGraph`. The algorithm was proven and the seam between the
 * algorithm and the brief was not, which is the shape of test this file exists
 * to add: not "does the router aim", but "does the aim reach the router".
 */
describe("the aim survives the brief parser", () => {
  const MARYLEBONE = { lat: 51.5175, lng: -0.1535 };
  const COVENT_GARDEN = { lat: 51.5115, lng: -0.1245 };

  it("reads back an aim the server resolved", () => {
    const brief = readBrief({
      where: "Marylebone",
      whereTo: "Covent Garden",
      holes: 9,
      aimFrom: MARYLEBONE,
      aimTo: COVENT_GARDEN,
    });
    expect(brief?.aimFrom).toEqual(MARYLEBONE);
    expect(brief?.aimTo).toEqual(COVENT_GARDEN);
  });

  it("answers null before a gather has resolved anything", () => {
    // The ordinary case on the way in: a host's form has no coordinates on it,
    // and the router reads a missing aim as "no destination named".
    const brief = readBrief({ where: "Shoreditch", holes: 9 });
    expect(brief?.aimFrom).toBeNull();
    expect(brief?.aimTo).toBeNull();
  });

  it("refuses a coordinate that is not one", () => {
    // The brief is the only door host input comes through, and this key is the
    // one thing on it the *server* writes — so anything that does not look
    // like a resolved point is nothing, rather than a NaN reaching the router.
    for (const bad of [
      { lat: "51.5", lng: -0.15 },
      { lat: 51.5 },
      { lat: Number.NaN, lng: -0.15 },
      { lat: 91, lng: 0 },
      { lat: 0, lng: 181 },
      "Marylebone",
      null,
      [],
    ]) {
      const brief = readBrief({ where: "Shoreditch", holes: 9, aimFrom: bad });
      expect(brief?.aimFrom, JSON.stringify(bad)).toBeNull();
    }
  });

  it("keeps the aim through the same-patch collapse", () => {
    // Naming one area for both ends collapses `whereTo` and zeroes the reach.
    // The aim is the server's own resolution and is not part of that rule —
    // a single patch still has a centre worth walking out from.
    const brief = readBrief({
      where: "Shoreditch",
      whereTo: "shoreditch",
      holes: 9,
      aimFrom: MARYLEBONE,
      aimTo: MARYLEBONE,
    });
    expect(brief?.whereTo).toBe("");
    expect(brief?.reachKm).toBe(0);
    expect(brief?.aimFrom).toEqual(MARYLEBONE);
  });
});
