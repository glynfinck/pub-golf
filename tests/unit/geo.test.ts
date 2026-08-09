import { describe, expect, it } from "vitest";

import {
  boundsAround,
  boundsToCircle,
  estimateWalkMinutes,
  haversineKm,
} from "@/lib/geo";

describe("haversineKm", () => {
  it("is zero between a point and itself", () => {
    expect(haversineKm(51.5387, -0.0568, 51.5387, -0.0568)).toBe(0);
  });

  it("measures a degree of latitude at about 111 km", () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });

  it("does not care which end you start from", () => {
    const there = haversineKm(51.5387, -0.0568, 51.5654, -0.0755);
    const back = haversineKm(51.5654, -0.0755, 51.5387, -0.0568);
    expect(there).toBeCloseTo(back, 10);
  });

  it("shrinks a degree of longitude as it leaves the equator", () => {
    expect(haversineKm(60, 0, 60, 1)).toBeLessThan(haversineKm(0, 0, 0, 1));
  });
});

describe("estimateWalkMinutes", () => {
  const CAT_AND_MUTTON = { lat: 51.5387, lng: -0.0568 };

  it("has no estimate without both ends", () => {
    expect(estimateWalkMinutes(null, CAT_AND_MUTTON)).toBeNull();
    expect(estimateWalkMinutes(CAT_AND_MUTTON, null)).toBeNull();
  });

  it("has no estimate when either venue is missing a coordinate", () => {
    expect(
      estimateWalkMinutes({ lat: null, lng: -0.0568 }, CAT_AND_MUTTON),
    ).toBeNull();
    expect(
      estimateWalkMinutes({ lat: 51.5387, lng: null }, CAT_AND_MUTTON),
    ).toBeNull();
    expect(
      estimateWalkMinutes(CAT_AND_MUTTON, { lat: 51.5465, lng: null }),
    ).toBeNull();
  });

  it("still allows a minute between two pubs at the same address", () => {
    // Never zero: the walk view would show a countdown that was already over.
    expect(estimateWalkMinutes(CAT_AND_MUTTON, CAT_AND_MUTTON)).toBe(1);
  });

  it("walks at roughly 4.8 km/h", () => {
    // One degree of latitude, ~111.19 km, at 12.5 minutes per km.
    expect(estimateWalkMinutes({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBe(
      1390,
    );
  });

  it("gives a whole number of minutes", () => {
    const minutes = estimateWalkMinutes(CAT_AND_MUTTON, {
      lat: 51.5465,
      lng: -0.0755,
    });
    expect(Number.isInteger(minutes)).toBe(true);
    expect(minutes).toBeGreaterThan(0);
  });
});

describe("boundsToCircle", () => {
  it("centres on the middle of the viewport", () => {
    const { center } = boundsToCircle({
      north: 51.56,
      south: 51.52,
      east: -0.04,
      west: -0.08,
    });
    expect(center.lat).toBeCloseTo(51.54, 10);
    expect(center.lng).toBeCloseTo(-0.06, 10);
  });

  it("reaches the corner of the viewport", () => {
    const bounds = { north: 51.56, south: 51.52, east: -0.04, west: -0.08 };
    const { center, radiusMeters } = boundsToCircle(bounds);
    const toCorner =
      haversineKm(center.lat, center.lng, bounds.north, bounds.east) * 1000;
    expect(radiusMeters).toBeCloseTo(toCorner, -1);
  });

  it("caps a zoomed-out world at Google's 50 km maximum", () => {
    expect(
      boundsToCircle({ north: 60, south: 20, east: 40, west: -40 })
        .radiusMeters,
    ).toBe(50_000);
  });

  it("never asks a smaller question than 100 m", () => {
    expect(
      boundsToCircle({
        north: 51.5401,
        south: 51.54,
        east: -0.06,
        west: -0.0601,
      }).radiusMeters,
    ).toBe(100);
  });

  it("crosses the antimeridian without circling the globe", () => {
    // A viewport over Fiji: west of the line to east of it.
    const { center, radiusMeters } = boundsToCircle({
      north: -16,
      south: -19,
      east: -178,
      west: 177,
    });
    expect(Math.abs(center.lng)).toBeCloseTo(179.5, 10);
    expect(center.lat).toBeCloseTo(-17.5, 10);
    // Half the 5°-wide span, not half of the long way round.
    expect(radiusMeters).toBeLessThan(50_000 + 1);
    expect(radiusMeters).toBeGreaterThan(100);
  });
});

describe("boundsAround", () => {
  it("draws a kilometre box a kilometre wide", () => {
    const box = boundsAround({ lat: 0, lng: 0 }, 1000);
    expect(haversineKm(0, 0, box.north, 0)).toBeCloseTo(1, 2);
    expect(haversineKm(0, 0, 0, box.east)).toBeCloseTo(1, 2);
  });

  it("widens its longitude away from the equator", () => {
    const equator = boundsAround({ lat: 0, lng: 0 }, 1000);
    const north = boundsAround({ lat: 60, lng: 0 }, 1000);
    expect(north.east - north.west).toBeGreaterThan(
      equator.east - equator.west,
    );
    // But the ground distance stays a kilometre.
    expect(haversineKm(60, 0, 60, north.east)).toBeCloseTo(1, 2);
  });

  it("wraps across the antimeridian instead of leaving range", () => {
    const box = boundsAround({ lat: -17, lng: 179.999 }, 1000);
    expect(box.east).toBeLessThan(0);
    expect(box.west).toBeGreaterThan(0);
  });

  it("survives the pole rather than exceeding it", () => {
    expect(boundsAround({ lat: 89.9999, lng: 0 }, 5000).north).toBe(90);
  });
});
