import { describe, expect, it } from "vitest";

import { buildPlacesSearch, parseBounds } from "@/lib/pub-search";

const SOHO = { north: 51.517, south: 51.51, east: -0.128, west: -0.14 };
const IP = { lat: 51.5, lng: -0.12 };

describe("parseBounds", () => {
  it("accepts a Google viewport literal", () => {
    expect(parseBounds(SOHO)).toEqual(SOHO);
  });

  it("accepts an antimeridian viewport, east numerically below west", () => {
    const fiji = { north: -16, south: -19, east: -178, west: 177 };
    expect(parseBounds(fiji)).toEqual(fiji);
  });

  it("refuses everything that is not four in-range numbers", () => {
    expect(parseBounds(undefined)).toBeNull();
    expect(parseBounds(null)).toBeNull();
    expect(parseBounds("51,0,52,1")).toBeNull();
    expect(parseBounds({ north: "51", south: 50, east: 1, west: 0 })).toBeNull();
    expect(
      parseBounds({ north: 51, south: 50, east: 1, west: Number.NaN }),
    ).toBeNull();
    expect(parseBounds({ north: 91, south: 50, east: 1, west: 0 })).toBeNull();
    expect(parseBounds({ north: 51, south: 50, east: 181, west: 0 })).toBeNull();
  });

  it("refuses an upside-down viewport", () => {
    expect(parseBounds({ north: 50, south: 51, east: 1, west: 0 })).toBeNull();
  });
});

describe("buildPlacesSearch", () => {
  it("aims a query at the viewport when the map framed one", () => {
    const search = buildPlacesSearch({
      query: "The Crown",
      bounds: SOHO,
      ipBias: IP,
      language: "en-GB",
    });
    expect(search?.url).toContain("searchText");
    expect(search?.body).toMatchObject({
      textQuery: "The Crown",
      pageSize: 20,
      languageCode: "en-GB",
      locationBias: {
        rectangle: {
          low: { latitude: SOHO.south, longitude: SOHO.west },
          high: { latitude: SOHO.north, longitude: SOHO.east },
        },
      },
    });
  });

  it("aims a bare query at the player's city, not the data centre", () => {
    const search = buildPlacesSearch({
      query: "The Crown",
      bounds: null,
      ipBias: IP,
      language: null,
    });
    expect(search?.body).toMatchObject({
      pageSize: 8,
      locationBias: {
        circle: { center: { latitude: IP.lat, longitude: IP.lng } },
      },
    });
    expect(search?.body).not.toHaveProperty("languageCode");
  });

  it("sends an unaimed query rather than no query at all", () => {
    const search = buildPlacesSearch({
      query: "The Crown, Fitzrovia, London",
      bounds: null,
      ipBias: null,
      language: null,
    });
    expect(search?.url).toContain("searchText");
    expect(search?.body).not.toHaveProperty("locationBias");
  });

  it("asks what's here when the map has a patch and no query", () => {
    const search = buildPlacesSearch({
      query: null,
      bounds: SOHO,
      ipBias: IP,
      language: "en-GB",
    });
    expect(search?.url).toContain("searchNearby");
    expect(search?.body).toMatchObject({
      includedTypes: ["pub", "bar"],
      maxResultCount: 20,
      languageCode: "en-GB",
    });
    const restriction = search?.body.locationRestriction as {
      circle: { center: { latitude: number }; radius: number };
    };
    expect(restriction.circle.center.latitude).toBeCloseTo(51.5135, 4);
    expect(restriction.circle.radius).toBeGreaterThan(100);
    expect(restriction.circle.radius).toBeLessThanOrEqual(50_000);
  });

  it("walks out from the player's city with no patch and no query", () => {
    const search = buildPlacesSearch({
      query: null,
      bounds: null,
      ipBias: IP,
      language: null,
    });
    expect(search?.url).toContain("searchNearby");
    const restriction = search?.body.locationRestriction as {
      circle: { center: { latitude: number }; radius: number };
    };
    expect(restriction.circle.center.latitude).toBe(IP.lat);
    expect(restriction.circle.radius).toBe(3000);
  });

  it("has no question to ask with nothing to aim at", () => {
    expect(
      buildPlacesSearch({
        query: null,
        bounds: null,
        ipBias: null,
        language: "en-GB",
      }),
    ).toBeNull();
  });
});
