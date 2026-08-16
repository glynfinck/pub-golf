import { describe, expect, it } from "vitest";

import {
  checkCard,
  contractRecord,
  DETOUR_CEILING,
  TREK_LEG_KM,
  type ContractBrief,
} from "@/lib/caddy/contract";
import { EMPTY_FACTS, type CandidateDossier } from "@/lib/caddy/dossier";
import type { PlannedHole } from "@/lib/caddy/plan";

// ————————————————— fixtures —————————————————

function venueId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function candidate(n: number, over: Partial<CandidateDossier> = {}): CandidateDossier {
  return {
    id: `p${n}`,
    venueId: venueId(n),
    name: `The Pub ${n}`,
    address: `${n} Example Street`,
    rating: 4,
    reviewCount: 100,
    lat: 51.5,
    lng: -0.07 - n / 500,
    priceLevel: 2,
    facts: { ...EMPTY_FACTS },
    editorial: null,
    reviews: [],
    ...over,
  };
}

/** Holes strung west-to-east ~250m apart — an unremarkable, contract-clean walk. */
function hole(n: number, over: Partial<PlannedHole> = {}): PlannedHole {
  return {
    venue_id: venueId(n),
    venue_name: `The Pub ${n}`,
    address: `${n} Example Street`,
    rating: 4,
    lat: 51.5,
    lng: -0.07 - n / 500,
    drink: "Half of something local",
    par: 4,
    hazard: null,
    hazard_note: null,
    penalties: [],
    fit_note: null,
    ...over,
  };
}

const BRIEF: ContractBrief = { holes: 4, startVenueId: null, finishVenueId: null };

function card(...holes: PlannedHole[]): PlannedHole[] {
  return holes;
}

// ————————————————— the clauses —————————————————

describe("checkCard", () => {
  it("finds nothing on an honest card", () => {
    const candidates = [1, 2, 3, 4].map((n) => candidate(n));
    const report = checkCard(
      card(hole(1), hole(2), hole(3), hole(4)),
      BRIEF,
      candidates,
    );
    expect(report.clean).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("objects to the same pub twice", () => {
    const report = checkCard(card(hole(1), hole(2), hole(2), hole(4)), BRIEF);
    expect(report.clean).toBe(false);
    expect(report.findings.some((f) => f.clause === "real-venues" && f.hole === 3)).toBe(true);
  });

  it("objects to a venue the dossier never offered", () => {
    const candidates = [1, 2, 3].map((n) => candidate(n));
    const report = checkCard(card(hole(1), hole(2), hole(9)), { ...BRIEF, holes: 3 }, candidates);
    expect(report.findings.some((f) => f.clause === "real-venues" && f.hole === 3)).toBe(true);
  });

  it("passes venue membership vacuously when the dossier is swept", () => {
    const report = checkCard(card(hole(1), hole(2), hole(9), hole(4)), BRIEF, []);
    expect(report.findings.filter((f) => f.clause === "real-venues")).toEqual([]);
  });

  it("holds the pins to the ends", () => {
    const brief = { holes: 3, startVenueId: venueId(2), finishVenueId: venueId(1) };
    const report = checkCard(card(hole(1), hole(2), hole(3)), brief);
    const clauses = report.findings.filter((f) => f.clause === "pins-hold");
    expect(clauses).toHaveLength(2);
  });

  it("counts a short card", () => {
    const report = checkCard(card(hole(1), hole(2)), BRIEF);
    expect(report.findings.some((f) => f.clause === "full-count")).toBe(true);
  });

  it("objects to a hazard on the first hole and water on the last", () => {
    const report = checkCard(
      card(
        hole(1, { hazard: "bunker" }),
        hole(2),
        hole(3),
        hole(4, { hazard: "water" }),
      ),
      BRIEF,
    );
    const hazards = report.findings.filter((f) => f.clause === "hazards-legal");
    expect(hazards.map((f) => f.hole)).toEqual([1, 4]);
  });

  it("allows bunker and dogleg to finish a round", () => {
    const report = checkCard(
      card(hole(1), hole(2), hole(3), hole(4, { hazard: "dogleg" })),
      BRIEF,
    );
    expect(report.findings.filter((f) => f.clause === "hazards-legal")).toEqual([]);
  });

  it("calls a trek leg what it is", () => {
    // ~2.8km east on one leg at this latitude.
    const report = checkCard(
      card(hole(1), hole(2), hole(3, { lng: -0.07 - 3 / 500 - 0.04 }), hole(4, { lng: -0.07 - 4 / 500 - 0.04 })),
      BRIEF,
    );
    const finding = report.findings.find((f) => f.clause === "legs-in-bounds");
    expect(finding).toBeDefined();
    expect(TREK_LEG_KM).toBe(2);
  });

  it("calls a lap a lap", () => {
    // Out, back, out, back: four kilometres walked to reach 140 metres.
    const at = (lng: number) => ({ lng });
    const report = checkCard(
      card(
        hole(1, at(-0.07)),
        hole(2, at(-0.085)),
        hole(3, at(-0.0702)),
        hole(4, at(-0.0851)),
        hole(5, at(-0.072)),
      ),
      { ...BRIEF, holes: 5 },
    );
    expect(report.findings.some((f) => f.clause === "goes-somewhere")).toBe(true);
    expect(DETOUR_CEILING).toBe(3);
  });

  it("objects to a pint where Google says no beer, and lets null pass", () => {
    const candidates = [
      candidate(1, { facts: { ...EMPTY_FACTS, servesBeer: false } }),
      candidate(2), // servesBeer null — unknown is not no
      candidate(3),
      candidate(4),
    ];
    const report = checkCard(
      card(
        hole(1, { drink: "Pint of lager" }),
        hole(2, { drink: "Pint of lager" }),
        hole(3),
        hole(4),
      ),
      BRIEF,
      candidates,
    );
    const drinks = report.findings.filter((f) => f.clause === "drinks-pourable");
    expect(drinks.map((f) => f.hole)).toEqual([1]);
  });

  it("objects to a cocktail where the facts refuse it", () => {
    const candidates = [
      candidate(1, { facts: { ...EMPTY_FACTS, servesCocktails: false } }),
      candidate(2),
      candidate(3),
      candidate(4),
    ];
    const report = checkCard(
      card(hole(1, { drink: "Espresso martini" }), hole(2), hole(3), hole(4)),
      BRIEF,
      candidates,
    );
    expect(report.findings.some((f) => f.clause === "drinks-pourable" && f.hole === 1)).toBe(true);
  });
});

describe("contractRecord", () => {
  it("is compact and stable", () => {
    const report = checkCard(card(hole(1), hole(2)), BRIEF);
    const record = contractRecord(report);
    expect(record.clean).toBe(false);
    expect(record.findings.length).toBeGreaterThan(0);
    expect(Object.keys(record)).toEqual(["clean", "findings"]);
  });
});
