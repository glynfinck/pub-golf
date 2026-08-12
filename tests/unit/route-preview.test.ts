import { describe, expect, it } from "vitest";

import { haversineKm } from "@/lib/geo";

import {
  MAX_ASPECT,
  MIN_ASPECT,
  MIN_SPAN_DEG,
  previewFrame,
  walkRoute,
  type PreviewHole,
  type PreviewStop,
  ringPath,
} from "@/lib/route-preview";

const at = (x: number, y: number): PreviewStop => ({
  lat: 51.5 + y * 0.003,
  lng: -0.08 + x * 0.003,
});

describe("previewFrame", () => {
  it("shows nothing until there is a walk to show", () => {
    // Absence, not an empty frame — the rule the maps key already keeps.
    expect(previewFrame([])).toBeNull();
    expect(previewFrame([at(0, 0)])).toBeNull();
    expect(previewFrame([{ lat: null, lng: null }, { lat: null, lng: null }])).toBeNull();
  });

  it("covers every hole it draws", () => {
    const stops = [at(0, 0), at(3, 2), at(1, 4), at(2, 1)];
    const frame = previewFrame(stops);
    expect(frame).not.toBeNull();
    if (!frame) return;
    frame.holes.forEach((hole) => {
      expect(hole.lat).toBeLessThanOrEqual(frame.bounds.north);
      expect(hole.lat).toBeGreaterThanOrEqual(frame.bounds.south);
      expect(hole.lng).toBeLessThanOrEqual(frame.bounds.east);
      expect(hole.lng).toBeGreaterThanOrEqual(frame.bounds.west);
    });
  });

  it("numbers by position on the card, not by position on the map", () => {
    // A pub added by name has no coordinates and cannot be pinned. The holes
    // around it keep their real numbers, so the map reads as having a gap
    // rather than as a different card.
    const frame = previewFrame([at(0, 0), { lat: null, lng: null }, at(2, 0), at(1, 2)]);
    expect(frame?.holes.map((hole) => hole.hole)).toEqual([1, 3, 4]);
  });

  it("knows which hole finishes the round", () => {
    const frame = previewFrame([at(0, 0), at(2, 0), { lat: null, lng: null }, at(1, 2)]);
    expect(frame?.lastHole).toBe(4);
  });

  it("is always a landscape strip, whatever shape the route is", () => {
    // Deliberately overriding the route rather than reflecting it: a portrait
    // map at the top of a phone pushes the card it previews below the fold.
    [
      previewFrame([at(0, 0), at(0, 8)]), // straight north
      previewFrame([at(0, 0), at(8, 0)]), // straight east
      previewFrame([at(0, 0), at(1, 9)]), // tall and narrow
      previewFrame([at(0, 0), at(4, 4), at(2, 1)]),
    ].forEach((frame) => expect(frame!.aspect).toBeGreaterThanOrEqual(1));
  });

  it("measures the shape in metres, not degrees", () => {
    // The trap this branch has walked into three times: a degree of longitude
    // at 51.5°N is about 62% of a degree of latitude. Six steps east by two
    // north is 3:1 in raw degrees but only about 1.87:1 on the ground, and the
    // frame must follow the ground — otherwise every east–west crawl is framed
    // wider than it really is and the pins crowd the middle.
    const frame = previewFrame([at(0, 0), at(6, 2)]);
    expect(frame).not.toBeNull();
    const squash = Math.cos((51.5 * Math.PI) / 180);
    expect(frame!.aspect).toBeCloseTo((6 * squash) / 2, 1);
    // And specifically not the naive degree ratio, which would clamp to 2.6.
    expect(frame!.aspect).toBeLessThan(2.5);
  });

  it("gives a crawl up one street a wider frame than a wander round a quarter", () => {
    const alongAStreet = previewFrame([at(0, 0), at(6, 0), at(12, 0.2)]);
    const roundAQuarter = previewFrame([at(0, 0), at(4, 0), at(4, 4), at(0, 4)]);
    expect(alongAStreet!.aspect).toBeGreaterThan(roundAQuarter!.aspect);
  });

  it("clamps the frame so it is never a hairline or a skyscraper", () => {
    const deadStraight = previewFrame([at(0, 0), at(40, 0)]);
    const deadVertical = previewFrame([at(0, 0), at(0, 40)]);
    [deadStraight, deadVertical].forEach((frame) => {
      expect(frame!.aspect).toBeGreaterThanOrEqual(MIN_ASPECT - 1e-9);
      expect(frame!.aspect).toBeLessThanOrEqual(MAX_ASPECT + 1e-9);
    });
  });

  it("opens out a route too tight to frame", () => {
    // Three pubs on one corner would otherwise fit the map at maximum zoom,
    // looking straight down a chimney.
    const frame = previewFrame([at(0, 0), at(0.02, 0), at(0.04, 0.01)]);
    expect(frame).not.toBeNull();
    if (!frame) return;
    expect(frame.bounds.north - frame.bounds.south).toBeGreaterThanOrEqual(
      MIN_SPAN_DEG - 1e-9,
    );
    expect(frame.bounds.east - frame.bounds.west).toBeGreaterThanOrEqual(
      MIN_SPAN_DEG - 1e-9,
    );
  });

  it("survives every pub being on the same spot", () => {
    // Zero span in both axes: a real possibility, and a divide by zero if the
    // guard is missing.
    const frame = previewFrame([at(1, 1), at(1, 1), at(1, 1)]);
    expect(frame).not.toBeNull();
    expect(Number.isFinite(frame!.aspect)).toBe(true);
    expect(frame!.aspect).toBeGreaterThan(0);
  });

  it("survives a perfectly straight line, which has zero span in one axis", () => {
    [previewFrame([at(0, 0), at(4, 0)]), previewFrame([at(0, 0), at(0, 4)])].forEach(
      (frame) => {
        expect(Number.isFinite(frame!.aspect)).toBe(true);
        expect(frame!.aspect).toBeGreaterThan(0);
      },
    );
  });

  it("keeps north above south and east above west", () => {
    // Getting a bound the wrong way round hands Google an empty rectangle and
    // the map frames the whole planet.
    const frame = previewFrame([at(3, 4), at(0, 0), at(1, 2)]);
    expect(frame!.bounds.north).toBeGreaterThan(frame!.bounds.south);
    expect(frame!.bounds.east).toBeGreaterThan(frame!.bounds.west);
  });
});

/** A hole on the card, at a grid position, for the walking tests. */
const hole = (x: number, y: number, number: number): PreviewHole => ({
  ...(at(x, y) as { lat: number; lng: number }),
  hole: number,
});

describe("walkRoute", () => {
  const card = [hole(0, 0, 1), hole(4, 0, 2), hole(4, 3, 3), hole(0, 3, 4)];

  it("starts at the first pub with no line drawn yet", () => {
    // Not an empty map: the walk begins *at* a pub, so its pin is there from
    // the first frame and the line grows out of it.
    const walked = walkRoute(card, 0);
    expect(walked.reached).toBe(1);
    expect(walked.path).toEqual([{ lat: card[0].lat, lng: card[0].lng }]);
  });

  it("ends with the whole card, and stays there when asked for more", () => {
    [1, 1.5, 99].forEach((progress) => {
      const walked = walkRoute(card, progress);
      expect(walked.reached).toBe(card.length);
      expect(walked.path).toHaveLength(card.length);
      expect(walked.path.at(-1)).toEqual({ lat: card[3].lat, lng: card[3].lng });
    });
  });

  it("never goes backwards", () => {
    let previous = 0;
    for (let step = 0; step <= 100; step += 1) {
      const walked = walkRoute(card, step / 100);
      expect(walked.reached).toBeGreaterThanOrEqual(previous);
      previous = walked.reached;
    }
    expect(previous).toBe(card.length);
  });

  it("lands each pin exactly as the line reaches its pub", () => {
    // The pin and the end of the line are the same event. If they drift, a pin
    // appears out in the road or the line arrives at an empty corner.
    let seen = 1;
    for (let step = 0; step <= 200; step += 1) {
      const walked = walkRoute(card, step / 200);
      if (walked.reached > seen) {
        seen = walked.reached;
        const arrived = card[walked.reached - 1];
        expect(walked.path.at(-1)).toEqual({ lat: arrived.lat, lng: arrived.lng });
      }
    }
  });

  it("paces by how far the walk is, not by how many pubs are on it", () => {
    // One long leg then one short one. Half way through, an animation counting
    // pubs would already be at the second pub; one measuring the ground is
    // still out on the first leg — which is what makes the line move at a
    // steady speed on screen instead of lurching.
    const lopsided = [hole(0, 0, 1), hole(10, 0, 2), hole(11, 0, 3)];
    expect(walkRoute(lopsided, 0.5).reached).toBe(1);
    expect(walkRoute(lopsided, 0.5).path.at(-1)!.lng).toBeLessThan(lopsided[1].lng);
  });

  it("rests at each pub before setting off again", () => {
    // The pause is what gives each numbered pin its own beat. During it the
    // line does not move at all.
    const lopsided = [hole(0, 0, 1), hole(10, 0, 2), hole(11, 0, 3)];
    const justArrived = walkRoute(lopsided, 0.8);
    const stillThere = walkRoute(lopsided, 0.88);
    expect(justArrived.reached).toBe(2);
    expect(stillThere.reached).toBe(2);
    expect(stillThere.path).toEqual(justArrived.path);
  });

  it("draws nothing outside the route it was given", () => {
    const north = Math.max(...card.map((stop) => stop.lat));
    const south = Math.min(...card.map((stop) => stop.lat));
    const east = Math.max(...card.map((stop) => stop.lng));
    const west = Math.min(...card.map((stop) => stop.lng));
    for (let step = 0; step <= 60; step += 1) {
      walkRoute(card, step / 60).path.forEach((point) => {
        expect(point.lat).toBeGreaterThanOrEqual(south);
        expect(point.lat).toBeLessThanOrEqual(north);
        expect(point.lng).toBeGreaterThanOrEqual(west);
        expect(point.lng).toBeLessThanOrEqual(east);
      });
    }
  });

  it("survives a card with nothing to walk", () => {
    // No holes, one hole, and every pub on the same doorstep — the last of
    // which divides by a zero-length walk if the guard is missing.
    expect(walkRoute([], 0.5)).toEqual({ path: [], reached: 0 });
    expect(walkRoute([hole(0, 0, 1)], 0.5).reached).toBe(1);
    const stacked = [hole(1, 1, 1), hole(1, 1, 2), hole(1, 1, 3)];
    const walked = walkRoute(stacked, 0.5);
    expect(walked.reached).toBe(3);
    walked.path.forEach((point) => {
      expect(Number.isFinite(point.lat)).toBe(true);
      expect(Number.isFinite(point.lng)).toBe(true);
    });
  });
});

describe("ringPath", () => {
  it("closes the loop", () => {
    const ring = ringPath({ lat: 51.52, lng: -0.08 }, 1);
    expect(ring[0].lat).toBeCloseTo(ring[ring.length - 1].lat, 9);
    expect(ring[0].lng).toBeCloseTo(ring[ring.length - 1].lng, 9);
  });

  it("is round on the ground, not round in degrees", () => {
    // At London's latitude a degree of longitude is about six-tenths of a
    // degree of latitude. A ring drawn without that correction is an ellipse a
    // third too wide, which reads on the map as the radius being wrong.
    const centre = { lat: 51.52, lng: -0.08 };
    const ring = ringPath(centre, 2);
    const north = Math.max(...ring.map((p) => p.lat)) - centre.lat;
    const east = Math.max(...ring.map((p) => p.lng)) - centre.lng;
    expect(east / north).toBeCloseTo(1 / Math.cos((51.52 * Math.PI) / 180), 2);
  });

  it("puts every point the same distance out", () => {
    const centre = { lat: 51.52, lng: -0.08 };
    const spans = ringPath(centre, 1.5).map((p) =>
      haversineKm(centre.lat, centre.lng, p.lat, p.lng),
    );
    for (const span of spans) expect(span).toBeCloseTo(1.5, 2);
  });

  it("draws nothing for a radius of nothing", () => {
    expect(ringPath({ lat: 51.5, lng: -0.1 }, 0)).toEqual([]);
    expect(ringPath({ lat: 51.5, lng: -0.1 }, -1)).toEqual([]);
  });
});
