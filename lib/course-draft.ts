import type { PlannedCourse } from "@/lib/caddy/plan";
import { type RulesetPenalty } from "@/lib/ruleset";

/**
 * The drafting table's own state, kept out of the components that draw it.
 *
 * A course being edited is an ordered list of holes, and every edit the
 * builder offers — add, insert, move, swap the pub, take one off — is a pure
 * function from one list to the next. The number on a hole is its index and
 * nothing else, so none of this writes a number down; `holeRows` in
 * `lib/actions/courses.ts` numbers from the array on the way to Postgres.
 */

/** One hole on the drafting table. */
export interface DraftHole {
  /** Stable for the life of the draft, so a moved hole keeps its identity
   * when React re-keys the list. Never sent to the server — the row is
   * identified by its position. */
  id: string;
  venue_id: string | null;
  venue_name: string;
  address: string | null;
  rating: number | null;
  lat: number | null;
  lng: number | null;
  drink: string;
  par: number;
  hazard: "water" | "bunker" | "dogleg" | null;
  hazard_note: string | null;
  /** Local rules: offered on this hole's penalty sheet and nowhere else. */
  penalties: RulesetPenalty[];
  /** The stored walk leg — the fallback when there are no coordinates to
   * re-measure (curated copies, pubs added by name). Null on a new hole. */
  walk_minutes_to_next: number | null;
}

/** What a pub brings to a hole: the venue, and nothing about the drinking. */
export type PubFields = Pick<
  DraftHole,
  "venue_id" | "venue_name" | "address" | "rating" | "lat" | "lng"
>;

/** The house's opening offer on a newly plotted hole. */
export const DEFAULT_DRINK = "Pint of your choosing";
export const DEFAULT_PAR = 4;

/** A pub dressed as a hole for the first time. */
export function draftHole(pub: PubFields, id: string): DraftHole {
  return {
    id,
    ...pub,
    drink: DEFAULT_DRINK,
    par: DEFAULT_PAR,
    hazard: null,
    hazard_note: null,
    penalties: [],
    walk_minutes_to_next: null,
  };
}

/**
 * How a hole's stored walk leg is recognised: where it started and where it
 * went. A pub with no `venue_id` was added by name and is only ever itself.
 */
function venueKey(hole: DraftHole) {
  return hole.venue_id ?? `name:${hole.venue_name}`;
}

function legKeys(holes: DraftHole[]) {
  const keys = new Set<string>();
  for (let i = 0; i < holes.length - 1; i++)
    keys.add(`${venueKey(holes[i])}→${venueKey(holes[i + 1])}`);
  return keys;
}

/**
 * A stored walk leg belongs to a *pair* of pubs, not to a hole — so any edit
 * that changes who follows whom invalidates it. Holes with coordinates are
 * re-measured on save and never notice; a pub added by name has only the
 * stored number, and carrying it to a new neighbour would print a walking
 * time nobody measured. Clearing it makes the course say nothing rather than
 * something wrong.
 */
export function settleWalkLegs(
  before: DraftHole[],
  after: DraftHole[],
): DraftHole[] {
  const known = legKeys(before);
  return after.map((hole, index) => {
    if (hole.walk_minutes_to_next == null) return hole;
    const next = after[index + 1];
    const stillTrue =
      next !== undefined && known.has(`${venueKey(hole)}→${venueKey(next)}`);
    return stillTrue ? hole : { ...hole, walk_minutes_to_next: null };
  });
}

/** Clamps an insertion point onto the list, end included. */
function clampIndex(index: number, length: number) {
  return Math.min(Math.max(index, 0), length);
}

/** A hole added at the end of the card. */
export function appendHole(holes: DraftHole[], hole: DraftHole): DraftHole[] {
  return settleWalkLegs(holes, [...holes, hole]);
}

/** A hole inserted so that it becomes hole `index + 1`. */
export function insertHole(
  holes: DraftHole[],
  hole: DraftHole,
  index: number,
): DraftHole[] {
  const at = clampIndex(index, holes.length);
  return settleWalkLegs(holes, [
    ...holes.slice(0, at),
    hole,
    ...holes.slice(at),
  ]);
}

/** The hole taken off the card. Out of range, the card is unchanged. */
export function removeHole(holes: DraftHole[], index: number): DraftHole[] {
  if (index < 0 || index >= holes.length) return holes;
  return settleWalkLegs(
    holes,
    holes.filter((_, i) => i !== index),
  );
}

/**
 * The hole moved to a new position, everything between it shuffling up or
 * down by one. A move off either end is refused rather than clamped: the
 * chevron at the end of the list is disabled, and a silent no-op is a
 * better answer than a move that didn't go where it was aimed.
 */
export function moveHole(
  holes: DraftHole[],
  from: number,
  to: number,
): DraftHole[] {
  if (from < 0 || from >= holes.length) return holes;
  if (to < 0 || to >= holes.length || to === from) return holes;
  const next = [...holes];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return settleWalkLegs(holes, next);
}

/**
 * The pub behind a hole changed hands. The hole keeps its number and all its
 * dressing — par, drink, hazard, local rules — because none of that belonged
 * to the pub; only the venue did.
 */
export function replacePub(
  holes: DraftHole[],
  index: number,
  pub: PubFields,
): DraftHole[] {
  if (index < 0 || index >= holes.length) return holes;
  return settleWalkLegs(
    holes,
    holes.map((hole, i) => (i === index ? { ...hole, ...pub } : hole)),
  );
}

/** "Par 3 · half of stout · water" — a hole in one line, for the surfaces
 * that have to say what a change is about to keep. */
export function describeDressing(hole: DraftHole): string {
  const parts = [`par ${hole.par}`, hole.drink.trim() || DEFAULT_DRINK];
  if (hole.hazard) parts.push(`${hole.hazard} hazard`);
  if (hole.penalties.length > 0)
    parts.push(
      `${hole.penalties.length} local ${
        hole.penalties.length === 1 ? "rule" : "rules"
      }`,
    );
  return parts.join(" · ");
}

/**
 * A caddy's card as drafting-table rows.
 *
 * Shared by the card that has just arrived and the card being picked back up
 * after a refresh, which have to produce byte-identical holes — a resumed
 * table that dressed a hole even slightly differently would file that
 * difference over the host's course the next time anything saved.
 *
 * Lifted out of the drafting table when the Course Room needed to file a card
 * too. It had been the only filing path in the app, so a plan made anywhere
 * else was never written down at all: close the tab and a paid evening was
 * gone.
 */
export function draftFromPlan(planned: PlannedCourse): DraftHole[] {
  return planned.holes.map((hole) => ({
    id: crypto.randomUUID(),
    venue_id: hole.venue_id,
    venue_name: hole.venue_name,
    address: hole.address,
    rating: hole.rating,
    lat: hole.lat,
    lng: hole.lng,
    drink: hole.drink,
    par: hole.par,
    hazard: hole.hazard,
    hazard_note: hole.hazard_note,
    penalties: hole.penalties,
    walk_minutes_to_next: null,
  }));
}

/** The rows as the server takes them. A rule with no offence on it is a
 * half-typed thought, not a rule. */
export function draftOf(rows: DraftHole[], courseName: string) {
  return {
    name: courseName,
    holes: rows.map((hole) => ({
      venue_id: hole.venue_id,
      venue_name: hole.venue_name,
      drink: hole.drink,
      par: hole.par,
      hazard: hole.hazard,
      hazard_note: hole.hazard_note,
      penalties: hole.penalties.filter((rule) => rule.reason.trim() !== ""),
      lat: hole.lat,
      lng: hole.lng,
      walk_minutes_to_next: hole.walk_minutes_to_next,
    })),
  };
}
