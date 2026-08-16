import type { CandidateDossier } from "@/lib/caddy/dossier";
import {
  DWELL_MINUTES,
  LAST_ORDERS_MARGIN,
  openAt,
  openFor,
  type TeeOff,
} from "@/lib/caddy/hours";
import type { PlannedHole } from "@/lib/caddy/plan";
import { haversineKm, WALK_MINUTES_PER_KM } from "@/lib/geo";

/**
 * The repair ladder's one moving rung: swap a dead stop.
 *
 * The router refuses to build a walk through a shut door, but two things can
 * still put one on a finished card: the model swapped a stop the router had
 * placed (its judgement, honestly exercised over `<swaps>`), or the hours
 * are tighter than the drift the improvement passes allowed. Either way the
 * fix is arithmetic — the nearest open candidate stands in — and arithmetic
 * fixes it here, before the host ever sees the card, rather than a model
 * turn being spent apologising for it.
 *
 * Bounded on every side. Pinned tees never move (the host chose them, shut
 * or not — that is their call to keep). A stand-in must be within a short
 * walk of the stop it replaces, or the swap would quietly reshape the night
 * the host was promised; past that bound the stop stays and the contract
 * says so instead. Unknown hours never trigger a swap and never block one
 * being swapped *to* — no evidence is not adverse evidence, in both
 * directions.
 */

/** How far a stand-in may sit from the stop it replaces. Past this the cure
 * reshapes the walk more than the disease does. */
export const SWAP_REACH_KM = 0.8;

export interface DeadStopRepair {
  holes: PlannedHole[];
  /** 0-based indices of holes whose pub was swapped. */
  swapped: number[];
}

function arrivalAt(holes: PlannedHole[], index: number, teeOff: TeeOff): number {
  let walked = 0;
  for (let i = 1; i <= index; i += 1) {
    const prev = holes[i - 1];
    const here = holes[i];
    if (
      prev.lat != null &&
      prev.lng != null &&
      here.lat != null &&
      here.lng != null
    ) {
      walked +=
        haversineKm(prev.lat, prev.lng, here.lat, here.lng) *
        WALK_MINUTES_PER_KM;
    }
  }
  return teeOff.minutes + Math.round(walked) + index * DWELL_MINUTES;
}

/** Shut at this arrival — or, on the finish, open but past last orders.
 * Unknown hours answer no. */
function dead(
  hours: CandidateDossier["hours"],
  day: number,
  arrival: number,
  isFinish: boolean,
): boolean {
  if (!hours) return false;
  if (!openAt(hours, day, arrival)) return true;
  if (isFinish) {
    const left = openFor(hours, day, arrival);
    if (left !== null && left < LAST_ORDERS_MARGIN) return true;
  }
  return false;
}

/**
 * Swap every dead stop for its nearest open neighbour, where one exists in
 * reach. The stand-in keeps the hole's dressing — the drink, the par and the
 * hazard were chosen for the night's shape, not the wallpaper — and its
 * fit note says plainly why the pub changed.
 */
export function swapDeadStops(
  holes: PlannedHole[],
  candidates: CandidateDossier[],
  pins: { startVenueId: string | null; finishVenueId: string | null },
  teeOff: TeeOff | null,
): DeadStopRepair {
  if (!teeOff || holes.length === 0) return { holes, swapped: [] };
  const byVenue = new Map(candidates.map((c) => [c.venueId, c]));
  const onCard = new Set(
    holes.map((hole) => hole.venue_id).filter((id): id is string => id !== null),
  );

  const repaired = [...holes];
  const swapped: number[] = [];

  for (let index = 0; index < repaired.length; index += 1) {
    const hole = repaired[index];
    if (!hole.venue_id || hole.lat == null || hole.lng == null) continue;
    // The host's own pins are theirs to keep, open or shut.
    if (
      hole.venue_id === pins.startVenueId ||
      hole.venue_id === pins.finishVenueId
    ) {
      continue;
    }
    const isFinish = index === repaired.length - 1;
    // Arrivals re-derive from the card as it now stands, so an earlier swap
    // that moved a stop feeds the later holes' clocks.
    const arrival = arrivalAt(repaired, index, teeOff);
    const hours = byVenue.get(hole.venue_id)?.hours ?? null;
    if (!dead(hours, teeOff.day, arrival, isFinish)) continue;

    let best: CandidateDossier | null = null;
    let bestKm = SWAP_REACH_KM;
    for (const candidate of candidates) {
      if (onCard.has(candidate.venueId)) continue;
      if (candidate.lat == null || candidate.lng == null) continue;
      if (dead(candidate.hours ?? null, teeOff.day, arrival, isFinish)) continue;
      const km = haversineKm(hole.lat, hole.lng, candidate.lat, candidate.lng);
      if (km < bestKm) {
        bestKm = km;
        best = candidate;
      }
    }
    // Nothing open in reach: the stop stands and the contract will say so —
    // an honest finding beats a silent march across the patch.
    if (!best) continue;

    onCard.delete(hole.venue_id);
    onCard.add(best.venueId);
    repaired[index] = {
      ...hole,
      venue_id: best.venueId,
      venue_name: best.name,
      address: best.address,
      rating: best.rating,
      lat: best.lat,
      lng: best.lng,
      fit_note: "Swapped in — the first pick would be shut when you arrived.",
    };
    swapped.push(index);
  }

  return { holes: repaired, swapped };
}
