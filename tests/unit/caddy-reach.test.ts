import { describe, expect, it } from "vitest";

import { centreOf, reachOf } from "@/lib/caddy/reach";

/**
 * The reach is the one number two surfaces have to agree about — the ring on
 * the map and the sentence under the form — so it lives on its own and is
 * proved on its own.
 */

const FINSBURY_PARK = { lat: 51.5642, lng: -0.1064 };
const BROADWAY_MARKET = { lat: 51.5366, lng: -0.0616 };

describe("centreOf", () => {
  it("averages rather than trusting the first result", () => {
    // "Finsbury Park" returns pubs *near* Finsbury Park, and the first can sit
    // at the edge of it. A mean of the first few lands nearer the middle of
    // the area the host has in mind, which is what the ring is about.
    const centre = centreOf([
      { lat: 51.5, lng: -0.1 },
      { lat: 51.6, lng: -0.1 },
      { lat: 51.55, lng: -0.1 },
    ]);
    expect(centre?.lat).toBeCloseTo(51.55, 5);
  });

  it("ignores results with no position", () => {
    const centre = centreOf([
      { lat: null, lng: null },
      { lat: 51.5, lng: -0.1 },
    ]);
    expect(centre).toEqual({ lat: 51.5, lng: -0.1 });
  });

  it("gives nothing when there is nothing placed", () => {
    expect(centreOf([])).toBeNull();
    expect(centreOf([{ lat: null, lng: null }])).toBeNull();
  });

  it("only reads as far as it is told to", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ lat: 51 + i, lng: 0 }));
    // Two results, so the mean is of the first two and not of twenty.
    expect(centreOf(many, 2)?.lat).toBeCloseTo(51.5, 5);
  });
});

describe("reachOf", () => {
  it("draws the patch when there is only one area", () => {
    // A host who has typed one place should still see where the caddy is
    // about to look, sized to the patch the gather actually searches.
    const reach = reachOf(FINSBURY_PARK, null, 9);
    expect(reach?.centre).toEqual(FINSBURY_PARK);
    expect(reach?.km).toBeCloseTo(1.2, 5);
    expect(reach?.warn).toBe(false);
  });

  it("reaches to the second area when there is one", () => {
    // Finsbury Park to Broadway Market is a real round somebody walked, and
    // it is about four kilometres.
    const reach = reachOf(FINSBURY_PARK, BROADWAY_MARKET, 9);
    expect(reach?.km).toBeGreaterThan(3.5);
    expect(reach?.km).toBeLessThan(5);
    // Nine holes over four kilometres is half a kilometre a leg: a walk, but a
    // fair one, so nothing to warn about.
    expect(reach?.warn).toBe(false);
  });

  it("warns when the same two ends are stretched over too few holes", () => {
    // The identical walk over four holes is more than a kilometre between
    // drinks, which is a march. Same distance, different round.
    expect(reachOf(FINSBURY_PARK, BROADWAY_MARKET, 4)?.warn).toBe(true);
  });

  it("never shrinks the ring below the patch being searched", () => {
    // A destination inside the patch is already covered, so the ring stays the
    // patch rather than drawing something smaller than the area in play.
    const nearby = { lat: FINSBURY_PARK.lat + 0.002, lng: FINSBURY_PARK.lng };
    expect(reachOf(FINSBURY_PARK, nearby, 9)?.km).toBeCloseTo(1.2, 5);
  });

  it("draws nothing without a first area", () => {
    expect(reachOf(null, BROADWAY_MARKET, 9)).toBeNull();
    expect(reachOf(null, null, 9)).toBeNull();
  });

  it("does not divide by zero on a one-hole round", () => {
    expect(() => reachOf(FINSBURY_PARK, BROADWAY_MARKET, 1)).not.toThrow();
    expect(reachOf(FINSBURY_PARK, BROADWAY_MARKET, 1)?.warn).toBe(true);
  });

  it("agrees with the sentence the host reads", () => {
    // The ring turning amber and the warning appearing must be one event.
    // Both sides use the same threshold; this is what holds them together.
    for (const holes of [3, 4, 5, 6, 9, 12, 18]) {
      const reach = reachOf(FINSBURY_PARK, BROADWAY_MARKET, holes);
      const km = reach!.km;
      const warned = km / Math.max(holes - 1, 1) > 1.1;
      expect(reach!.warn, `${holes} holes`).toBe(warned);
    }
  });
});
