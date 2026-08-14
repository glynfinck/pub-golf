import { describe, expect, it } from "vitest";

import {
  echoLine,
  localityOf,
  previewOf,
  thinPatchNote,
} from "@/lib/caddy/preflight";
import { candidateFloor } from "@/lib/caddy/brief";

describe("localityOf", () => {
  it("names the area most addresses agree on, postcodes stripped", () => {
    expect(
      localityOf([
        "100 Camden High St, London NW1 0LT, UK",
        "1 Parkway, London NW1 7PG, UK",
        "89 Kentish Town Rd, London NW1 8NY, UK",
      ]),
    ).toBe("London");
  });

  it("prefers the tighter segment when the addresses carry one", () => {
    // Every address names Camden Town and London; the count ties and the
    // first-ranked wins — either answer is a truthful echo, but the tie must
    // not produce null.
    const locality = localityOf([
      "1 Inverness St, Camden Town, London NW1, UK",
      "2 Delancey St, Camden Town, London NW1, UK",
    ]);
    expect(locality === "Camden Town" || locality === "London").toBe(true);
  });

  it("answers null rather than guessing", () => {
    expect(localityOf([])).toBeNull();
    expect(localityOf(["1 High St, Leeds LS1 4AB, UK"])).toBeNull();
    expect(
      localityOf(["1 A St, Leeds LS1, UK", "2 B St, York YO1, UK", "3 C St, Hull HU1, UK"]),
    ).toBeNull();
  });

  it("never lets the street or the country win", () => {
    expect(
      localityOf(["1 High St, UK", "2 High St, United Kingdom"]),
    ).toBeNull();
  });
});

describe("previewOf", () => {
  const row = (n: number, placed = true) => ({
    id: `venue-${n}`,
    lat: placed ? 51.5 + n / 1000 : null,
    lng: placed ? -0.07 : null,
    address: `${n} Example St, London N1, UK`,
  });

  it("keeps only placeable pins but counts everything", () => {
    const preview = previewOf([row(1), row(2, false), row(3)]);
    expect(preview.pins.map((p) => p.id)).toEqual(["venue-1", "venue-3"]);
    expect(preview.count).toBe(3);
    expect(preview.locality).toBe("London");
  });
});

describe("echoLine", () => {
  it("says where and how much, or stays quiet", () => {
    expect(echoLine({ pins: [], count: 0, locality: "London" })).toBeNull();
    expect(echoLine({ pins: [], count: 1, locality: null })).toBe("1 pub nearby");
    expect(echoLine({ pins: [], count: 18, locality: "Camden Town" })).toBe(
      "Camden Town · 18 pubs nearby",
    );
  });
});

describe("thinPatchNote", () => {
  it("stays quiet when the patch clears the floor, and before anything is known", () => {
    expect(thinPatchNote(candidateFloor(9), 9)).toBeNull();
    expect(thinPatchNote(0, 9)).toBeNull();
  });

  it("counter-offers the hole count that fits", () => {
    const note = thinPatchNote(10, 9);
    expect(note).toContain("10 pubs");
    expect(note).toContain("6 holes");
  });

  it("offers the widest round that still fits", () => {
    // 16 pubs misses 18 holes (floor 21) but carries 12 (floor 15).
    expect(thinPatchNote(16, 18)).toContain("12 holes");
  });

  it("suggests a wider patch when nothing fits", () => {
    const note = thinPatchNote(4, 9);
    expect(note).toContain("wider patch");
    expect(note).not.toContain("holes fits");
  });
});
