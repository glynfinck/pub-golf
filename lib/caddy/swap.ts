import type { MenuNode } from "@/lib/caddy/menu";
import { haversineKm } from "@/lib/geo";

/**
 * Changing one stop, without paying for a new card.
 *
 * The menu offers whole walks and the caddy dresses one of them, which leaves
 * the commonest note a host has nowhere to go: *this one, but not that pub.*
 * Somebody's ex works there, they were barred in 2019, it was rubbish last
 * time. Until now the answers were re-roll the whole card (a paid go) or edit
 * it by hand on the drafting table afterwards, and neither is "swap that one".
 *
 * **Free, and it has to be.** This is arithmetic over the lean nodes the
 * browser already holds — the same reason re-dialling the menu costs nothing.
 * Nothing here calls Google, nothing here calls the model, and a host can turn
 * a walk over as many times as they like before spending a credit on dressing
 * it. That is the covenant as a module: the caddy is paid for judgement, not
 * for recomputing a distance.
 *
 * Pure and total. An index off the end, an id nobody offered, a node missing
 * from the map — every one of them returns the walk unchanged rather than
 * throwing, because this sits under a finger on a map and a thrown error there
 * is a blank screen over a plan somebody is halfway through.
 */

export interface SwapOption {
  /** Candidate id — the only name for a pub that crosses the wire. */
  id: string;
  name: string;
  rating: number | null;
  address: string | null;
  /** How far this pub is from the one it would replace. */
  awayKm: number;
  /**
   * What taking it does to the whole walk, in kilometres. Negative is a
   * shorter night. Shown because "a better pub 400m off the line" and "a
   * better pub that adds a mile" are different offers and the host should not
   * have to work out which one they are being made.
   */
  deltaKm: number;
}

function legKm(from: MenuNode | undefined, to: MenuNode | undefined): number {
  if (!from || !to) return 0;
  return haversineKm(from.lat, from.lng, to.lat, to.lng);
}

/** The whole walk's length, for the before-and-after a swap is judged on. */
export function walkKm(stops: string[], nodes: MenuNode[]): number {
  return walkStats(stops, nodes).totalKm;
}

/**
 * The walk's own figures, recomputed.
 *
 * The router's `PlannedRoute` carries these, and the moment a host swaps a
 * stop they describe a walk that no longer exists — a stat line quietly
 * reporting the caddy's version of a route the host has edited is worse than
 * no stat line. So the screen recomputes from whatever walk is actually drawn.
 */
export function walkStats(
  stops: string[],
  nodes: MenuNode[],
): { totalKm: number; worstLegKm: number } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let totalKm = 0;
  let worstLegKm = 0;
  for (let i = 1; i < stops.length; i += 1) {
    const km = legKm(byId.get(stops[i - 1]), byId.get(stops[i]));
    totalKm += km;
    worstLegKm = Math.max(worstLegKm, km);
  }
  return { totalKm, worstLegKm };
}

/**
 * What else could stand at this stop, nearest first.
 *
 * Nearest rather than best, deliberately: the host has tapped a pin and asked
 * "not this one" — the question is about *this corner of the walk*, so a
 * five-star pub two miles away is not an answer to it. The walk's own delta
 * rides along so a tempting detour has to admit to being one.
 */
export function swapOptions(
  stops: string[],
  index: number,
  nodes: MenuNode[],
  limit = 6,
): SwapOption[] {
  if (index < 0 || index >= stops.length) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const here = byId.get(stops[index]);
  if (!here) return [];

  const taken = new Set(stops);
  const before = index > 0 ? byId.get(stops[index - 1]) : undefined;
  const after =
    index < stops.length - 1 ? byId.get(stops[index + 1]) : undefined;
  const currentKm = legKm(before, here) + legKm(here, after);

  return (
    nodes
      .filter((node) => !taken.has(node.id))
      .map((node) => ({
        id: node.id,
        name: node.name,
        rating: node.rating,
        address: node.address,
        awayKm: haversineKm(here.lat, here.lng, node.lat, node.lng),
        deltaKm: legKm(before, node) + legKm(node, after) - currentKm,
      }))
      // Ties break on id so the list is the same every render — a menu that
      // reshuffles under a thumb is a menu you cannot tap.
      .sort((a, b) => a.awayKm - b.awayKm || (a.id < b.id ? -1 : 1))
      .slice(0, Math.max(0, limit))
  );
}

/** The walk with one stop replaced. Refuses a pub already on the card — a
 * walk that visits the same door twice is not a swap, it is a bug. */
export function withSwap(stops: string[], index: number, id: string): string[] {
  if (index < 0 || index >= stops.length) return stops;
  if (stops.includes(id)) return stops;
  const next = [...stops];
  next[index] = id;
  return next;
}

/**
 * The walk with one stop moved a place earlier or later.
 *
 * The other half of "not this one": sometimes the pub is right and its
 * *position* is wrong — the loud one belongs at hole two rather than hole
 * eight, the one with the food belongs in the middle. Moving is a straight
 * exchange with the neighbour, so the walk keeps its length and its
 * membership and only its order changes.
 */
export function withMove(
  stops: string[],
  index: number,
  delta: number,
): string[] {
  const to = index + delta;
  if (index < 0 || index >= stops.length) return stops;
  if (to < 0 || to >= stops.length) return stops;
  const next = [...stops];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
