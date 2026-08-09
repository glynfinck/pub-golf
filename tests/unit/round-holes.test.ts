import { describe, expect, it } from "vitest";

import { legInto, legsAfterSwap, type HoleLeg } from "@/lib/round-holes";

// Three pubs a few hundred metres apart in Hackney, and one across town.
const CAT_AND_MUTTON = { lat: 51.5387, lng: -0.0568 };
const PUB_ON_THE_PARK = { lat: 51.5417, lng: -0.0559 };
const MARKSMAN = { lat: 51.5299, lng: -0.0662 };
const ACROSS_TOWN = { lat: 51.5074, lng: -0.1657 };

function card(...coords: (LatLngLike | null)[]): HoleLeg[] {
  return coords.map((point, index) => ({
    number: index + 1,
    coords: point,
    walk_minutes_to_next: index === coords.length - 1 ? null : 9,
  }));
}
type LatLngLike = { lat: number; lng: number };

describe("legsAfterSwap", () => {
  it("re-measures the walk in and the walk out", () => {
    const legs = legsAfterSwap(
      card(CAT_AND_MUTTON, PUB_ON_THE_PARK, MARKSMAN),
      2,
      ACROSS_TOWN,
    );
    expect(legs.map((leg) => leg.number)).toEqual([1, 2]);
    // Both legs now cross London, so both are long — and neither is the 9
    // that was measured to the pub that just came off.
    for (const leg of legs) expect(leg.walk_minutes_to_next).toBeGreaterThan(60);
  });

  it("touches nothing but the two legs either side", () => {
    const legs = legsAfterSwap(
      card(CAT_AND_MUTTON, PUB_ON_THE_PARK, MARKSMAN, ACROSS_TOWN),
      2,
      MARKSMAN,
    );
    // Holes 3 and 4 were never about hole 2.
    expect(legs.map((leg) => leg.number)).toEqual([1, 2]);
  });

  it("has no walk in when the first hole changes", () => {
    const legs = legsAfterSwap(
      card(CAT_AND_MUTTON, PUB_ON_THE_PARK, MARKSMAN),
      1,
      ACROSS_TOWN,
    );
    expect(legs.map((leg) => leg.number)).toEqual([1]);
  });

  it("leaves the last hole walking nowhere", () => {
    const legs = legsAfterSwap(
      card(CAT_AND_MUTTON, PUB_ON_THE_PARK, MARKSMAN),
      3,
      ACROSS_TOWN,
    );
    expect(legs).toContainEqual({ number: 3, walk_minutes_to_next: null });
  });

  it("clears both legs when the new pub has no coordinates", () => {
    // Added by name: there is nothing to measure, and the stored 9 was
    // measured to a pub that is no longer on the hole.
    const legs = legsAfterSwap(
      card(CAT_AND_MUTTON, PUB_ON_THE_PARK, MARKSMAN),
      2,
      null,
    );
    expect(legs).toEqual([
      { number: 1, walk_minutes_to_next: null },
      { number: 2, walk_minutes_to_next: null },
    ]);
  });

  it("clears the walk in when the hole before it never had coordinates", () => {
    const legs = legsAfterSwap(
      card(null, PUB_ON_THE_PARK, MARKSMAN),
      2,
      ACROSS_TOWN,
    );
    expect(legs[0]).toEqual({ number: 1, walk_minutes_to_next: null });
    expect(legs[1].walk_minutes_to_next).toBeGreaterThan(60);
  });

  it("changes nothing for a hole that is not on the round", () => {
    expect(legsAfterSwap(card(CAT_AND_MUTTON, MARKSMAN), 7, ACROSS_TOWN)).toEqual(
      [],
    );
    expect(legsAfterSwap([], 1, ACROSS_TOWN)).toEqual([]);
  });

  it("measures the leg from the new pub at whichever end it sits", () => {
    // The same leg — Cat and Mutton to across town — arrived at twice: once
    // by swapping the pub it walks to, once by swapping the pub it walks
    // from. The walk out of a new pub is measured as carefully as the walk in.
    const walkedTo = legsAfterSwap(
      card(CAT_AND_MUTTON, PUB_ON_THE_PARK, MARKSMAN),
      2,
      ACROSS_TOWN,
    );
    const walkedFrom = legsAfterSwap(
      card(PUB_ON_THE_PARK, ACROSS_TOWN, MARKSMAN),
      1,
      CAT_AND_MUTTON,
    );
    expect(walkedTo[0]).toEqual({ number: 1, walk_minutes_to_next: 104 });
    expect(walkedFrom[0]).toEqual(walkedTo[0]);
  });
});

describe("legInto", () => {
  it("is the leg the hole before it walks", () => {
    expect(
      legInto(
        [
          { number: 1, walk_minutes_to_next: 12 },
          { number: 2, walk_minutes_to_next: 4 },
        ],
        2,
      ),
    ).toBe(12);
  });

  it("is nothing when that leg could not be measured", () => {
    expect(
      legInto([{ number: 1, walk_minutes_to_next: null }], 2),
    ).toBeNull();
  });

  it("is nothing walking to the first hole", () => {
    expect(legInto([{ number: 1, walk_minutes_to_next: 12 }], 1)).toBeNull();
  });
});
