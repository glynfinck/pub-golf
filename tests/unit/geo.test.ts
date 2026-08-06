import { describe, expect, it } from "vitest";

import { estimateWalkMinutes, haversineKm } from "@/lib/geo";

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
