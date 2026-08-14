import type { CaddyBrief } from "@/lib/caddy/brief";
import {
  EMPTY_FACTS,
  type CandidateDossier,
} from "@/lib/caddy/dossier";
import type { TeeOff } from "@/lib/caddy/hours";
import { classifyPatch, shapeNote } from "@/lib/caddy/shape";
import {
  buildRouteGraph,
  targetKmFor,
  type RouteGraph,
} from "@/lib/caddy/route-graph";

/**
 * The route menu: the walks, on screen, before the model.
 *
 * The router has always computed a handful of genuinely different walks — and
 * handed them to the model, which picked one. The host never saw the menu,
 * so the one judgement they are best placed to make (*what shape of night is
 * this?*) was delegated, paid for, and discovered after the fact. This module
 * is the menu's wire shape: what the open step answers with, and what the
 * browser re-routes over when a dial moves.
 *
 * **Lean on purpose.** A node carries a name, a position and a rating — the
 * same class of thing the free search already shows anyone — and never the
 * dossier's paid half: no facts, no price level, no editorial, no reviews.
 * The browser can re-run the router over this (the router is pure and reads
 * exactly these fields), but the caddy's reading matter stays server-side.
 *
 * **The server trusts none of it back.** A chosen walk returns as candidate
 * ids and `chosenWalkFrom` re-derives everything against the server's own
 * dossier: unknown id, repeated id, wrong length — any of them and the answer
 * is null, which the caller reads as "caddy's choice". Tampering degrades;
 * it never errors.
 */

export interface MenuNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rating: number | null;
}

export interface MenuRoute {
  /** Candidate ids, walking order. */
  stops: string[];
  character: string;
  totalKm: number;
  worstLegKm: number;
  variety: number;
}

export interface CaddyMenu {
  nodes: MenuNode[];
  routes: MenuRoute[];
  startId: string | null;
  finishId: string | null;
  aimFrom: { lat: number; lng: number } | null;
  aimTo: { lat: number; lng: number } | null;
  reachKm: number;
  /** When the round tees off, so a browser re-route keeps the same clock. */
  teeOff: TeeOff | null;
  /** The drawn walk, so a browser re-route keeps the same axis. */
  stroke: { lat: number; lng: number }[] | null;
  /** The patch's shape, said out loud where it is remarkable — two pockets
   * with a march between, one street. Null for the ordinary blob. */
  note: string | null;
}

/** A pinned tee arrives as a `venues` row id; the graph speaks candidate
 * ids. Same resolution `patchBlock` makes, kept private there too. */
function candidateIdFor(
  candidates: CandidateDossier[],
  venueId: string | null,
): string | null {
  if (!venueId) return null;
  return candidates.find((c) => c.venueId === venueId)?.id ?? null;
}

function menuRoutes(graph: RouteGraph): MenuRoute[] {
  return graph.routes.map((route) => ({
    stops: route.stops,
    character: route.character,
    totalKm: Math.round(route.totalKm * 100) / 100,
    worstLegKm: Math.round(route.worstLegKm * 100) / 100,
    variety: route.variety,
  }));
}

/** The menu for a gathered patch — the same graph the model will be handed,
 * shaped for the screen. */
export function menuOf(
  candidates: CandidateDossier[],
  brief: CaddyBrief,
): CaddyMenu {
  const teeOff =
    brief.teeOffDay != null
      ? { day: brief.teeOffDay, minutes: brief.teeOffMinutes }
      : null;
  const graph = buildRouteGraph(candidates, {
    holes: brief.holes,
    startId: candidateIdFor(candidates, brief.startVenueId),
    finishId: candidateIdFor(candidates, brief.finishVenueId),
    targetKm: targetKmFor(brief.stretch, brief.holes, brief.reachKm),
    aimFrom: brief.aimFrom,
    aimTo: brief.aimTo,
    teeOff,
    stroke: brief.stroke,
  });
  const names = new Map(candidates.map((c) => [c.id, c.name]));
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      name: names.get(node.id) ?? "",
      lat: node.lat,
      lng: node.lng,
      rating: node.rating,
    })),
    routes: menuRoutes(graph),
    startId: candidateIdFor(candidates, brief.startVenueId),
    finishId: candidateIdFor(candidates, brief.finishVenueId),
    aimFrom: brief.aimFrom ?? null,
    aimTo: brief.aimTo ?? null,
    reachKm: brief.reachKm,
    teeOff,
    stroke: brief.stroke,
    note: shapeNote(classifyPatch(graph.nodes)),
  };
}

/**
 * The menu's nodes, dressed back up as a dossier the router will accept.
 *
 * The browser re-routes with this when a dial moves: same `buildRouteGraph`,
 * same objectives, zero server round-trips. The paid fields are honestly
 * empty rather than faked — the fact-reading objectives lose their teeth in
 * the preview, and the server rebuilds the full graph for the model exactly
 * as before, so nothing the caddy reads is degraded.
 */
export function leanDossier(nodes: MenuNode[]): CandidateDossier[] {
  return nodes.map((node) => ({
    id: node.id,
    venueId: node.id,
    name: node.name,
    address: null,
    rating: node.rating,
    reviewCount: null,
    lat: node.lat,
    lng: node.lng,
    priceLevel: null,
    facts: { ...EMPTY_FACTS },
    editorial: null,
    reviews: [],
  }));
}

/** Re-run the menu in the browser over lean nodes, dials applied. */
export function rerouteMenu(
  menu: CaddyMenu,
  dials: { holes: number; stretch: number },
): MenuRoute[] {
  const graph = buildRouteGraph(leanDossier(menu.nodes), {
    holes: dials.holes,
    startId: menu.startId,
    finishId: menu.finishId,
    targetKm: targetKmFor(dials.stretch, dials.holes, menu.reachKm),
    aimFrom: menu.aimFrom,
    aimTo: menu.aimTo,
    // Lean nodes carry no hours, so this is inert in the browser today —
    // carried anyway so the wire shape does not change when they do.
    teeOff: menu.teeOff ?? null,
    stroke: menu.stroke ?? null,
  });
  return menuRoutes(graph);
}

/**
 * A chosen walk, off the wire and never trusted.
 *
 * Null unless it is exactly a walk the dossier could carry: every id known,
 * no id twice, the full hole count. Null reads as "caddy's choice" — the
 * degradation is the security model, because an error here would let a
 * tampered request break a paid plan.
 */
export function chosenWalkFrom(
  raw: unknown,
  candidates: CandidateDossier[],
  holes: number,
): string[] | null {
  if (!Array.isArray(raw) || raw.length !== holes) return null;
  const known = new Set(candidates.map((c) => c.id));
  const seen = new Set<string>();
  const stops: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    if (!known.has(entry) || seen.has(entry)) return null;
    seen.add(entry);
    stops.push(entry);
  }
  return stops;
}
