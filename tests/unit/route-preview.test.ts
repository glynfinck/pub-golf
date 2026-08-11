import { describe, expect, it } from "vitest";

import {
  MAX_ASPECT,
  MIN_ASPECT,
  MIN_SPAN_DEG,
  previewFrame,
  type PreviewStop,
} from "@/lib/route-preview";

const at = (x: number, y: number): PreviewStop => ({
  lat: 51.5 + y * 0.003,
  lng: -0.08 + x * 0.003,
});

describe("previewFrame", () => {
  it("shows nothing until there is a walk to show", () => {
    // Absence, not an empty frame — the rule the maps key already keeps.
    expect(previewFrame([])).toBeNull();
    expect(previewFrame([at(0, 0)])).toBeNull();
    expect(previewFrame([{ lat: null, lng: null }, { lat: null, lng: null }])).toBeNull();
  });

  it("covers every hole it draws", () => {
    const stops = [at(0, 0), at(3, 2), at(1, 4), at(2, 1)];
    const frame = previewFrame(stops);
    expect(frame).not.toBeNull();
    if (!frame) return;
    frame.holes.forEach((hole) => {
      expect(hole.lat).toBeLessThanOrEqual(frame.bounds.north);
      expect(hole.lat).toBeGreaterThanOrEqual(frame.bounds.south);
      expect(hole.lng).toBeLessThanOrEqual(frame.bounds.east);
      expect(hole.lng).toBeGreaterThanOrEqual(frame.bounds.west);
    });
  });

  it("numbers by position on the card, not by position on the map", () => {
    // A pub added by name has no coordinates and cannot be pinned. The holes
    // around it keep their real numbers, so the map reads as having a gap
    // rather than as a different card.
    const frame = previewFrame([at(0, 0), { lat: null, lng: null }, at(2, 0), at(1, 2)]);
    expect(frame?.holes.map((hole) => hole.hole)).toEqual([1, 3, 4]);
  });

  it("knows which hole finishes the round", () => {
    const frame = previewFrame([at(0, 0), at(2, 0), { lat: null, lng: null }, at(1, 2)]);
    expect(frame?.lastHole).toBe(4);
  });

  it("is always a landscape strip, whatever shape the route is", () => {
    // Deliberately overriding the route rather than reflecting it: a portrait
    // map at the top of a phone pushes the card it previews below the fold.
    [
      previewFrame([at(0, 0), at(0, 8)]), // straight north
      previewFrame([at(0, 0), at(8, 0)]), // straight east
      previewFrame([at(0, 0), at(1, 9)]), // tall and narrow
      previewFrame([at(0, 0), at(4, 4), at(2, 1)]),
    ].forEach((frame) => expect(frame!.aspect).toBeGreaterThanOrEqual(1));
  });

  it("measures the shape in metres, not degrees", () => {
    // The trap this branch has walked into three times: a degree of longitude
    // at 51.5°N is about 62% of a degree of latitude. Six steps east by two
    // north is 3:1 in raw degrees but only about 1.87:1 on the ground, and the
    // frame must follow the ground — otherwise every east–west crawl is framed
    // wider than it really is and the pins crowd the middle.
    const frame = previewFrame([at(0, 0), at(6, 2)]);
    expect(frame).not.toBeNull();
    const squash = Math.cos((51.5 * Math.PI) / 180);
    expect(frame!.aspect).toBeCloseTo((6 * squash) / 2, 1);
    // And specifically not the naive degree ratio, which would clamp to 2.6.
    expect(frame!.aspect).toBeLessThan(2.5);
  });

  it("gives a crawl up one street a wider frame than a wander round a quarter", () => {
    const alongAStreet = previewFrame([at(0, 0), at(6, 0), at(12, 0.2)]);
    const roundAQuarter = previewFrame([at(0, 0), at(4, 0), at(4, 4), at(0, 4)]);
    expect(alongAStreet!.aspect).toBeGreaterThan(roundAQuarter!.aspect);
  });

  it("clamps the frame so it is never a hairline or a skyscraper", () => {
    const deadStraight = previewFrame([at(0, 0), at(40, 0)]);
    const deadVertical = previewFrame([at(0, 0), at(0, 40)]);
    [deadStraight, deadVertical].forEach((frame) => {
      expect(frame!.aspect).toBeGreaterThanOrEqual(MIN_ASPECT - 1e-9);
      expect(frame!.aspect).toBeLessThanOrEqual(MAX_ASPECT + 1e-9);
    });
  });

  it("opens out a route too tight to frame", () => {
    // Three pubs on one corner would otherwise fit the map at maximum zoom,
    // looking straight down a chimney.
    const frame = previewFrame([at(0, 0), at(0.02, 0), at(0.04, 0.01)]);
    expect(frame).not.toBeNull();
    if (!frame) return;
    expect(frame.bounds.north - frame.bounds.south).toBeGreaterThanOrEqual(
      MIN_SPAN_DEG - 1e-9,
    );
    expect(frame.bounds.east - frame.bounds.west).toBeGreaterThanOrEqual(
      MIN_SPAN_DEG - 1e-9,
    );
  });

  it("survives every pub being on the same spot", () => {
    // Zero span in both axes: a real possibility, and a divide by zero if the
    // guard is missing.
    const frame = previewFrame([at(1, 1), at(1, 1), at(1, 1)]);
    expect(frame).not.toBeNull();
    expect(Number.isFinite(frame!.aspect)).toBe(true);
    expect(frame!.aspect).toBeGreaterThan(0);
  });

  it("survives a perfectly straight line, which has zero span in one axis", () => {
    [previewFrame([at(0, 0), at(4, 0)]), previewFrame([at(0, 0), at(0, 4)])].forEach(
      (frame) => {
        expect(Number.isFinite(frame!.aspect)).toBe(true);
        expect(frame!.aspect).toBeGreaterThan(0);
      },
    );
  });

  it("keeps north above south and east above west", () => {
    // Getting a bound the wrong way round hands Google an empty rectangle and
    // the map frames the whole planet.
    const frame = previewFrame([at(3, 4), at(0, 0), at(1, 2)]);
    expect(frame!.bounds.north).toBeGreaterThan(frame!.bounds.south);
    expect(frame!.bounds.east).toBeGreaterThan(frame!.bounds.west);
  });
});
