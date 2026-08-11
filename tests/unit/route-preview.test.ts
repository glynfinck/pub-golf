import { describe, expect, it } from "vitest";

import {
  MAX_ASPECT,
  MIN_ASPECT,
  PREVIEW_PADDING,
  PREVIEW_WIDTH,
  projectRoute,
  routePath,
  type PreviewStop,
} from "@/lib/route-preview";

const at = (x: number, y: number): PreviewStop => ({
  lat: 51.5 + y * 0.003,
  lng: -0.08 + x * 0.003,
});

describe("projectRoute", () => {
  it("draws nothing until there is a leg to draw", () => {
    // Absence, not an empty frame: the same rule the maps key already keeps.
    expect(projectRoute([])).toBeNull();
    expect(projectRoute([at(0, 0)])).toBeNull();
    expect(projectRoute([{ lat: null, lng: null }, { lat: null, lng: null }])).toBeNull();
  });

  it("keeps every hole that has a position, in order", () => {
    const preview = projectRoute([at(0, 0), at(1, 1), at(2, 0)]);
    expect(preview?.points.map((p) => p.hole)).toEqual([1, 2, 3]);
  });

  it("numbers by position on the card, not by position in the drawing", () => {
    // A pub added by name has no coordinates and cannot be drawn. The holes
    // around it keep their real numbers, so the drawing reads as having a gap
    // rather than as a different card.
    const preview = projectRoute([at(0, 0), { lat: null, lng: null }, at(2, 0), at(1, 1)]);
    expect(preview?.points.map((p) => p.hole)).toEqual([1, 3, 4]);
  });

  it("stays inside the frame, pins and all", () => {
    const preview = projectRoute([at(0, 0), at(3, 2), at(1, 3), at(2, 0)]);
    expect(preview).not.toBeNull();
    if (!preview) return;
    preview.points.forEach((point) => {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(preview.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(preview.height);
    });
  });

  it("squashes longitude, so ground distance is what gets drawn", () => {
    // The bug this prevents: a degree of longitude at 51.5°N is about 62% of a
    // degree of latitude, so plotting raw lng against lat stretches every route
    // east–west and a straight street reads as a diagonal.
    //
    // These four corners span an equal number of *degrees* each way, which is
    // emphatically not a square on the ground — it is about 416m wide by 667m
    // tall. So the correct drawing is taller than it is wide. Without the
    // squash the aspect would be exactly 1 and it would come out square, which
    // is the failure being guarded against.
    const preview = projectRoute([at(0, 0), at(2, 0), at(2, 2), at(0, 2)]);
    expect(preview).not.toBeNull();
    if (!preview) return;
    expect(preview.height).toBeGreaterThan(preview.width);
    expect(preview.height / preview.width).not.toBeCloseTo(1, 2);
  });

  it("takes its height from the route's own shape", () => {
    // A crawl up one street is long and thin; a wander round a quarter is
    // squarer. Fitting both into one fixed box wastes it and shrinks the pins.
    const alongAStreet = projectRoute([at(0, 0), at(4, 0), at(8, 0.1)]);
    const roundAQuarter = projectRoute([at(0, 0), at(3, 0), at(3, 4), at(0, 4)]);
    expect(alongAStreet!.height).toBeLessThan(roundAQuarter!.height);
  });

  it("clamps the frame so it is never a sliver or a skyscraper", () => {
    const dead_straight = projectRoute([at(0, 0), at(20, 0), at(40, 0)]);
    const dead_vertical = projectRoute([at(0, 0), at(0, 20), at(0, 40)]);
    [dead_straight, dead_vertical].forEach((preview) => {
      const aspect = preview!.height / preview!.width;
      expect(aspect).toBeGreaterThanOrEqual(MIN_ASPECT - 1e-9);
      expect(aspect).toBeLessThanOrEqual(MAX_ASPECT + 1e-9);
    });
  });

  it("never distorts the shape to fill the frame", () => {
    // One scale for both axes. A route that doubles back must look like it
    // doubles back, not like a tidier route that happens to fit better.
    const preview = projectRoute([at(0, 0), at(4, 0), at(4, 1), at(0, 1)]);
    expect(preview).not.toBeNull();
    if (!preview) return;
    const [a, b, c] = preview.points;

    // Four grid steps east against one north is *not* a 4:1 rectangle on the
    // ground — the eastward steps are shortened by cos(latitude). The ratio
    // that must survive projection is the one measured in metres, so it is
    // derived here rather than guessed at.
    const squash = Math.cos((51.5 * Math.PI) / 180);
    const onTheGround = (4 * squash) / 1;

    const longSide = Math.abs(b.x - a.x);
    const shortSide = Math.abs(c.y - b.y);
    expect(longSide / shortSide).toBeCloseTo(onTheGround, 1);
  });

  it("survives every pub being on the same spot", () => {
    // Zero span in both axes: a real possibility, and a divide by zero if the
    // guard is missing.
    const preview = projectRoute([at(1, 1), at(1, 1), at(1, 1)]);
    expect(preview).not.toBeNull();
    preview?.points.forEach((point) => {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    });
  });

  it("survives a perfectly straight line, which has zero span in one axis", () => {
    const preview = projectRoute([at(0, 0), at(1, 0), at(2, 0)]);
    preview?.points.forEach((point) => {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    });
  });

  it("puts north at the top", () => {
    // Screen y grows downward and latitude grows north, so the projection
    // flips. Getting this wrong draws every route upside down.
    const preview = projectRoute([at(0, 0), at(0, 4)]);
    expect(preview!.points[0].y).toBeGreaterThan(preview!.points[1].y);
  });

  it("centres the walk rather than jamming it into a corner", () => {
    // A tall route in a wide frame has spare width; it should be shared.
    const preview = projectRoute([at(0, 0), at(0, 4), at(0.2, 8)]);
    expect(preview).not.toBeNull();
    if (!preview) return;
    const xs = preview.points.map((p) => p.x);
    const leftGap = Math.min(...xs);
    const rightGap = preview.width - Math.max(...xs);
    expect(leftGap).toBeCloseTo(rightGap, 1);
    expect(leftGap).toBeGreaterThanOrEqual(PREVIEW_PADDING - 1e-9);
  });

  it("draws in a hundred-wide box, whatever the route", () => {
    expect(projectRoute([at(0, 0), at(9, 3)])?.width).toBe(PREVIEW_WIDTH);
  });
});

describe("routePath", () => {
  it("is a move then a line per leg", () => {
    const preview = projectRoute([at(0, 0), at(2, 0), at(2, 2)]);
    const path = routePath(preview!.points);
    expect(path.startsWith("M")).toBe(true);
    expect(path.match(/L/g)).toHaveLength(2);
  });

  it("is empty rather than broken with nothing to draw", () => {
    expect(routePath([])).toBe("");
  });
});
