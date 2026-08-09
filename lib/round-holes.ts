import { estimateWalkMinutes, type LatLng } from "@/lib/geo";

/**
 * The round's own holes, once the card is snapshotted and being played.
 *
 * A course on the drafting table is an ordered list that can be rebuilt at
 * will (`lib/course-draft.ts`); a round's holes are fixed in number and
 * numbering, because scores and penalties key on the hole *number* and
 * nothing else. The one thing that can still change is which pub a hole is
 * played at — the shutters come down, the kitchen stops serving, the place
 * turns out to be a members' club — and that is a swap in place.
 */

/** One hole as the walk cares about it: where it is, and how far to the next. */
export interface HoleLeg {
  number: number;
  /** The venue's coordinates. Null for a pub added by name, which has none. */
  coords: LatLng | null;
  walk_minutes_to_next: number | null;
}

/** A leg to write back: the hole it belongs to, and its new length. */
export interface LegUpdate {
  number: number;
  walk_minutes_to_next: number | null;
}

/**
 * The legs that change when one hole's pub changes hands: the walk *into*
 * that hole, and the walk *out* of it. Both were measured to a pub that is
 * no longer there, so neither can stand — and where the new pub has no
 * coordinates there is nothing to measure, which is a null rather than the
 * old number carried forward to a stranger.
 *
 * `holes` must be in playing order. A hole not on the round changes nothing.
 */
export function legsAfterSwap(
  holes: HoleLeg[],
  number: number,
  coords: LatLng | null,
): LegUpdate[] {
  const index = holes.findIndex((hole) => hole.number === number);
  if (index === -1) return [];

  const updates: LegUpdate[] = [];

  const previous = holes[index - 1];
  if (previous)
    updates.push({
      number: previous.number,
      walk_minutes_to_next: estimateWalkMinutes(previous.coords, coords),
    });

  // The last hole walks nowhere, which estimateWalkMinutes answers for us:
  // there is no next hole to measure to.
  const next = holes[index + 1];
  updates.push({
    number,
    walk_minutes_to_next: estimateWalkMinutes(coords, next?.coords ?? null),
  });

  return updates;
}

/** The walk the group is on right now: into `number`, from the hole before
 * it. Null when there is no measurement to make — the walk then runs on
 * "when you get there", the same as a round whose course carries no legs. */
export function legInto(legs: LegUpdate[], number: number): number | null {
  return (
    legs.find((leg) => leg.number === number - 1)?.walk_minutes_to_next ?? null
  );
}
