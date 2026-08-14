import { describe, expect, it } from "vitest";

import { swapDeadStops, SWAP_REACH_KM } from "@/lib/caddy/repair";
import { EMPTY_FACTS, type CandidateDossier } from "@/lib/caddy/dossier";
import type { PlannedHole } from "@/lib/caddy/plan";

// ————————————————— fixtures —————————————————

function venueId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const OPEN_ALL_DAY = [{ day: 5, open: 600, close: 1500 }];
const SHUT_EVENINGS = [{ day: 5, open: 600, close: 1100 }]; // closes 18:20

function candidate(n: number, over: Partial<CandidateDossier> = {}): CandidateDossier {
  return {
    id: `p${n}`,
    venueId: venueId(n),
    name: `The Pub ${n}`,
    address: null,
    rating: 4,
    reviewCount: 100,
    lat: 51.5,
    lng: -0.07 - n * 0.002,
    priceLevel: 2,
    facts: { ...EMPTY_FACTS },
    editorial: null,
    reviews: [],
    hours: OPEN_ALL_DAY,
    ...over,
  };
}

function hole(n: number, over: Partial<PlannedHole> = {}): PlannedHole {
  return {
    venue_id: venueId(n),
    venue_name: `The Pub ${n}`,
    address: null,
    rating: 4,
    lat: 51.5,
    lng: -0.07 - n * 0.002,
    drink: "Half of something local",
    par: 4,
    hazard: null,
    hazard_note: null,
    penalties: [],
    fit_note: null,
    ...over,
  };
}

const NO_PINS = { startVenueId: null, finishVenueId: null };
const TEE_OFF = { day: 5, minutes: 1140 }; // 7pm

describe("swapDeadStops", () => {
  it("swaps a shut stop for its nearest open neighbour, dressing kept", () => {
    // Hole 2's pub shut at 18:20; candidate 9 sits ~150m away and is open.
    const candidates = [
      candidate(1),
      candidate(2, { hours: SHUT_EVENINGS }),
      candidate(3),
      candidate(9, { lat: 51.5, lng: -0.07 - 2 * 0.002 - 0.002 }),
    ];
    const card = [hole(1), hole(2, { drink: "G&T", par: 3 }), hole(3)];
    const { holes, swapped } = swapDeadStops(card, candidates, NO_PINS, TEE_OFF);
    expect(swapped).toEqual([1]);
    expect(holes[1].venue_id).toBe(venueId(9));
    expect(holes[1].venue_name).toBe("The Pub 9");
    // The dressing was chosen for the night's shape, so it stays.
    expect(holes[1].drink).toBe("G&T");
    expect(holes[1].par).toBe(3);
    expect(holes[1].fit_note).toContain("Swapped in");
  });

  it("never moves a pinned tee, shut or not", () => {
    const candidates = [candidate(1, { hours: SHUT_EVENINGS }), candidate(2), candidate(9)];
    const card = [hole(1), hole(2)];
    const { swapped } = swapDeadStops(
      card,
      candidates,
      { startVenueId: venueId(1), finishVenueId: null },
      TEE_OFF,
    );
    expect(swapped).toEqual([]);
  });

  it("unknown hours never trigger a swap", () => {
    const candidates = [candidate(1, { hours: null }), candidate(2), candidate(9)];
    const { swapped } = swapDeadStops(
      [hole(1), hole(2)],
      candidates,
      NO_PINS,
      TEE_OFF,
    );
    expect(swapped).toEqual([]);
  });

  it("leaves a stop standing when nothing open is in reach", () => {
    // The only alternative sits ~2km away — past SWAP_REACH_KM.
    const candidates = [
      candidate(1),
      candidate(2, { hours: SHUT_EVENINGS }),
      candidate(9, { lng: -0.07 - 2 * 0.002 - 0.03 }),
    ];
    const { holes, swapped } = swapDeadStops(
      [hole(1), hole(2)],
      candidates,
      NO_PINS,
      TEE_OFF,
    );
    expect(swapped).toEqual([]);
    expect(holes[1].venue_id).toBe(venueId(2));
    expect(SWAP_REACH_KM).toBeLessThan(1);
  });

  it("does nothing at all without a tee-off day", () => {
    const candidates = [candidate(1, { hours: SHUT_EVENINGS }), candidate(2)];
    const { holes, swapped } = swapDeadStops(
      [hole(1), hole(2)],
      candidates,
      NO_PINS,
      null,
    );
    expect(swapped).toEqual([]);
    expect(holes[0].venue_id).toBe(venueId(1));
  });
});
