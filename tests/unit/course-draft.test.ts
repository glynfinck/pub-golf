import { describe, expect, it } from "vitest";

import {
  appendHole,
  DEFAULT_DRINK,
  DEFAULT_PAR,
  describeDressing,
  draftHole,
  insertHole,
  moveHole,
  removeHole,
  replacePub,
  type DraftHole,
  type PubFields,
} from "@/lib/course-draft";

/** A pub off the Places cache — it has coordinates, so its legs re-measure. */
function pub(name: string, overrides: Partial<PubFields> = {}): PubFields {
  return {
    venue_id: `venue-${name.toLowerCase().replace(/\W+/g, "-")}`,
    venue_name: name,
    address: `${name} Street`,
    rating: 4.2,
    lat: 51.5,
    lng: -0.06,
    ...overrides,
  };
}

/** A pub typed in by hand: no id, no coordinates, only a stored walk leg. */
function namedPub(name: string): PubFields {
  return {
    venue_id: null,
    venue_name: name,
    address: null,
    rating: null,
    lat: null,
    lng: null,
  };
}

/** A card of named pubs with the walking already measured between them. */
function card(...names: string[]): DraftHole[] {
  return names.map((name, index) => ({
    ...draftHole(namedPub(name), `id-${name}`),
    walk_minutes_to_next: index === names.length - 1 ? null : 7,
  }));
}

const names = (holes: DraftHole[]) => holes.map((hole) => hole.venue_name);
const legs = (holes: DraftHole[]) =>
  holes.map((hole) => hole.walk_minutes_to_next);

describe("draftHole", () => {
  it("dresses a new pub in the house defaults", () => {
    const hole = draftHole(pub("The Ship"), "id-1");
    expect(hole).toMatchObject({
      id: "id-1",
      venue_name: "The Ship",
      drink: DEFAULT_DRINK,
      par: DEFAULT_PAR,
      hazard: null,
      hazard_note: null,
      penalties: [],
      walk_minutes_to_next: null,
    });
  });
});

describe("appendHole", () => {
  it("adds to the end", () => {
    const holes = appendHole(card("Ship", "Anchor"), draftHole(pub("Bear"), "x"));
    expect(names(holes)).toEqual(["Ship", "Anchor", "Bear"]);
  });

  it("clears the leg of the hole that used to be last", () => {
    // Anchor's leg was null as the last hole; Ship's leg still runs to
    // Anchor and survives untouched.
    const holes = appendHole(card("Ship", "Anchor"), draftHole(pub("Bear"), "x"));
    expect(legs(holes)).toEqual([7, null, null]);
  });
});

describe("insertHole", () => {
  it("puts the pub at the position asked for", () => {
    const holes = insertHole(card("Ship", "Anchor"), draftHole(pub("Bear"), "x"), 0);
    expect(names(holes)).toEqual(["Bear", "Ship", "Anchor"]);
  });

  it("inserts between two holes", () => {
    const holes = insertHole(card("Ship", "Anchor"), draftHole(pub("Bear"), "x"), 1);
    expect(names(holes)).toEqual(["Ship", "Bear", "Anchor"]);
  });

  it("clamps an index past the end onto the end", () => {
    const holes = insertHole(card("Ship", "Anchor"), draftHole(pub("Bear"), "x"), 9);
    expect(names(holes)).toEqual(["Ship", "Anchor", "Bear"]);
  });

  it("drops the split leg but keeps the legs that still run", () => {
    // Ship→Anchor is broken by the insert; Anchor→Bear never existed.
    const holes = insertHole(
      card("Ship", "Anchor", "Fountain"),
      draftHole(pub("Bear"), "x"),
      1,
    );
    expect(names(holes)).toEqual(["Ship", "Bear", "Anchor", "Fountain"]);
    expect(legs(holes)).toEqual([null, null, 7, null]);
  });
});

describe("removeHole", () => {
  it("takes the hole off the card", () => {
    expect(names(removeHole(card("Ship", "Anchor", "Bear"), 1))).toEqual([
      "Ship",
      "Bear",
    ]);
  });

  it("clears the leg of the hole left pointing somewhere new", () => {
    // Ship now walks to Bear, which nobody measured; Bear was last and
    // stays last.
    expect(legs(removeHole(card("Ship", "Anchor", "Bear"), 1))).toEqual([
      null,
      null,
    ]);
  });

  it("keeps untouched legs", () => {
    // Removing the last hole leaves Ship→Anchor exactly as it was.
    expect(legs(removeHole(card("Ship", "Anchor", "Bear"), 2))).toEqual([
      7,
      null,
    ]);
  });

  it("leaves the card alone when the index is off it", () => {
    const holes = card("Ship", "Anchor");
    expect(removeHole(holes, 5)).toBe(holes);
    expect(removeHole(holes, -1)).toBe(holes);
  });
});

describe("moveHole", () => {
  it("moves a hole earlier", () => {
    expect(names(moveHole(card("Ship", "Anchor", "Bear"), 2, 0))).toEqual([
      "Bear",
      "Ship",
      "Anchor",
    ]);
  });

  it("moves a hole later", () => {
    expect(names(moveHole(card("Ship", "Anchor", "Bear"), 0, 2))).toEqual([
      "Anchor",
      "Bear",
      "Ship",
    ]);
  });

  it("swaps a neighbouring pair", () => {
    expect(names(moveHole(card("Ship", "Anchor", "Bear"), 0, 1))).toEqual([
      "Anchor",
      "Ship",
      "Bear",
    ]);
  });

  it("refuses a move off either end rather than clamping it", () => {
    const holes = card("Ship", "Anchor", "Bear");
    expect(moveHole(holes, 0, -1)).toBe(holes);
    expect(moveHole(holes, 2, 3)).toBe(holes);
    expect(moveHole(holes, 1, 1)).toBe(holes);
    expect(moveHole(holes, 7, 0)).toBe(holes);
  });

  it("keeps the pairs that survived the move and clears the rest", () => {
    // Anchor→Bear is the one pair still standing after Ship goes to the end.
    const holes = moveHole(card("Ship", "Anchor", "Bear"), 0, 2);
    expect(names(holes)).toEqual(["Anchor", "Bear", "Ship"]);
    expect(legs(holes)).toEqual([7, null, null]);
  });

  it("carries the hole's dressing with it", () => {
    const holes = card("Ship", "Anchor", "Bear");
    holes[2] = { ...holes[2], par: 6, drink: "Dark rum, neat", hazard: "water" };
    const moved = moveHole(holes, 2, 0);
    expect(moved[0]).toMatchObject({
      venue_name: "Bear",
      par: 6,
      drink: "Dark rum, neat",
      hazard: "water",
    });
  });
});

describe("replacePub", () => {
  const dressed = (): DraftHole[] => {
    const holes = card("Ship", "Anchor");
    holes[0] = {
      ...holes[0],
      par: 3,
      drink: "Half of stout, no hands",
      hazard: "water",
      hazard_note: "No toilet for the whole hole",
      penalties: [{ strokes: 3, reason: "Drinking with your right hand" }],
    };
    return holes;
  };

  it("changes the venue and nothing else", () => {
    const holes = replacePub(dressed(), 0, pub("The Bear"));
    expect(holes[0]).toMatchObject({
      venue_name: "The Bear",
      venue_id: "venue-the-bear",
      address: "The Bear Street",
      rating: 4.2,
      par: 3,
      drink: "Half of stout, no hands",
      hazard: "water",
      hazard_note: "No toilet for the whole hole",
      penalties: [{ strokes: 3, reason: "Drinking with your right hand" }],
    });
  });

  it("keeps the hole in its place", () => {
    const holes = replacePub(card("Ship", "Anchor", "Bear"), 1, pub("Fountain"));
    expect(names(holes)).toEqual(["Ship", "Fountain", "Bear"]);
  });

  it("keeps the hole's identity, so the list does not re-key under it", () => {
    const holes = replacePub(dressed(), 0, pub("The Bear"));
    expect(holes[0].id).toBe("id-Ship");
  });

  it("clears the stored legs either side of the pub that changed", () => {
    // Ship→Anchor is gone in both directions: the walk into hole 2 and the
    // walk out of it were both measured to a pub that is no longer there.
    const holes = replacePub(card("Ship", "Anchor", "Bear"), 1, namedPub("Fountain"));
    expect(legs(holes)).toEqual([null, null, null]);
  });

  it("leaves legs elsewhere on the card alone", () => {
    const holes = replacePub(
      card("Ship", "Anchor", "Bear", "Fountain"),
      3,
      namedPub("Marksman"),
    );
    // Only the leg into the replaced hole was about it at all.
    expect(legs(holes)).toEqual([7, 7, null, null]);
  });

  it("leaves the card alone when the index is off it", () => {
    const holes = card("Ship");
    expect(replacePub(holes, 4, pub("Bear"))).toBe(holes);
  });
});

describe("describeDressing", () => {
  it("says what a swap is about to keep", () => {
    const hole: DraftHole = {
      ...draftHole(pub("The Ship"), "id-1"),
      par: 3,
      drink: "Half of stout, no hands",
      hazard: "water",
      penalties: [{ strokes: 3, reason: "Right hand" }],
    };
    expect(describeDressing(hole)).toBe(
      "par 3 · Half of stout, no hands · water hazard · 1 local rule",
    );
  });

  it("counts more than one local rule", () => {
    const hole: DraftHole = {
      ...draftHole(pub("The Ship"), "id-1"),
      penalties: [
        { strokes: 1, reason: "One" },
        { strokes: 2, reason: "Two" },
      ],
    };
    expect(describeDressing(hole)).toBe(
      `par 4 · ${DEFAULT_DRINK} · 2 local rules`,
    );
  });

  it("falls back to the house drink when the field has been emptied", () => {
    const hole: DraftHole = { ...draftHole(pub("The Ship"), "id-1"), drink: "  " };
    expect(describeDressing(hole)).toBe(`par 4 · ${DEFAULT_DRINK}`);
  });
});
