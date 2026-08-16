import { haversineKm } from "@/lib/geo";

/**
 * The patch's shape, diagnosed before anything is routed.
 *
 * A gather is a point cloud, and point clouds have shapes the router used to
 * discover the hard way: two pockets with a dead gap route as one patch with
 * a march in the middle, and one high street routes best when the axis is
 * trusted outright. One cheap pass classifies the cloud — single-linkage
 * clustering at walking radius, then the spread of the biggest cluster — and
 * the diagnosis becomes a sentence the menu can say and a fact a test can
 * hold. Pure throughout; at forty nodes the naive O(n²) is nothing.
 */

export type PatchShape =
  | { kind: "blob" }
  | {
      kind: "pockets";
      /** Sizes of the two biggest pockets. */
      sizes: [number, number];
      /** The dead ground between them, kilometres edge to edge. */
      gapKm: number;
    }
  | { kind: "line" };

/** Two pubs closer than this walk together; further and they are strangers.
 * The single-linkage radius. */
const LINK_KM = 0.5;

/** A gap between pockets has to be a real march to be worth a sentence. */
const POCKET_GAP_KM = 0.8;

/** A pocket smaller than this is an outlier, not a second night. */
const POCKET_MIN = 3;

/** Spread along the principal axis this many times the spread across it
 * reads as one street rather than a neighbourhood. */
const LINE_RATIO = 4;

interface Point {
  lat: number;
  lng: number;
}

function clusters(points: Point[], linkKm: number): number[][] {
  const labels = new Array<number>(points.length).fill(-1);
  let next = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (labels[i] !== -1) continue;
    labels[i] = next;
    const queue = [i];
    while (queue.length > 0) {
      const at = queue.pop()!;
      for (let j = 0; j < points.length; j += 1) {
        if (labels[j] !== -1) continue;
        if (
          haversineKm(points[at].lat, points[at].lng, points[j].lat, points[j].lng) <=
          linkKm
        ) {
          labels[j] = next;
          queue.push(j);
        }
      }
    }
    next += 1;
  }
  const out: number[][] = Array.from({ length: next }, () => []);
  labels.forEach((label, index) => out[label].push(index));
  return out;
}

/** The shortest hop between two clusters, edge to edge. */
function gapBetween(points: Point[], a: number[], b: number[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const i of a) {
    for (const j of b) {
      best = Math.min(
        best,
        haversineKm(points[i].lat, points[i].lng, points[j].lat, points[j].lng),
      );
    }
  }
  return best;
}

export function classifyPatch(points: Point[]): PatchShape {
  if (points.length < POCKET_MIN * 2) return { kind: "blob" };

  const found = clusters(points, LINK_KM)
    .filter((cluster) => cluster.length >= POCKET_MIN)
    .sort((a, b) => b.length - a.length);

  if (found.length >= 2) {
    const gapKm = gapBetween(points, found[0], found[1]);
    if (gapKm >= POCKET_GAP_KM) {
      return {
        kind: "pockets",
        sizes: [found[0].length, found[1].length],
        gapKm: Math.round(gapKm * 100) / 100,
      };
    }
  }

  // One cloud. A line is a cloud whose spread is all in one direction —
  // the covariance's eigenvalue ratio, on the local flat frame.
  const scale = Math.cos((points[0].lat * Math.PI) / 180);
  const mx = points.reduce((a, p) => a + p.lng, 0) / points.length;
  const my = points.reduce((a, p) => a + p.lat, 0) / points.length;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const p of points) {
    const dx = (p.lng - mx) * scale;
    const dy = p.lat - my;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const half = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const major = trace / 2 + half;
  const minor = trace / 2 - half;
  if (minor <= 0 || major / minor >= LINE_RATIO * LINE_RATIO) {
    return { kind: "line" };
  }
  return { kind: "blob" };
}

/** The diagnosis as a sentence for the menu, or null for the unremarkable
 * case — a note on every patch is a note nobody reads. */
export function shapeNote(shape: PatchShape): string | null {
  if (shape.kind === "pockets") {
    const mins = Math.max(1, Math.round(shape.gapKm * 13.3));
    return `Two pockets here, about ${mins} min apart — a walk that bridges them has one long leg in it.`;
  }
  if (shape.kind === "line") {
    return "One street, really — the walks here all run along it.";
  }
  return null;
}
