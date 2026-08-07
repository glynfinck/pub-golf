/**
 * Course templates seed a new round's holes until the map-based course
 * builder (Google Places) lands. The flagship template is the printed
 * Glyn Invitational card.
 */

import type { RulesetPenalty } from "@/lib/ruleset";

export interface TemplateHole {
  number: number;
  venue_name: string;
  drink: string;
  par: number;
  hazard: "water" | "bunker" | "dogleg" | null;
  hazard_note: string | null;
  /** Local rules: on the card at this pub and nowhere else. */
  penalties: RulesetPenalty[];
  walk_minutes_to_next: number | null;
}

export const INVITATIONAL_COURSE: TemplateHole[] = [
  { number: 1, venue_name: "Cat & Mutton", drink: "Pint of lager", par: 5, hazard: null, hazard_note: null, penalties: [], walk_minutes_to_next: 8 },
  { number: 2, venue_name: "Pub on the Park", drink: "Bottle of cider", par: 4, hazard: null, hazard_note: null, penalties: [], walk_minutes_to_next: 12 },
  { number: 3, venue_name: "The Pembury Tavern", drink: "Pint of Five Points", par: 5, hazard: "dogleg", hazard_note: "Hand your glass to the player on your left — drink whatever reaches you", penalties: [{ strokes: 2, reason: "Drinking before the pass is complete" }], walk_minutes_to_next: 14 },
  { number: 4, venue_name: "The Clapton Hart", drink: "Pint of craft", par: 4, hazard: null, hazard_note: null, penalties: [], walk_minutes_to_next: 7 },
  { number: 5, venue_name: "Crooked Billet", drink: "Pint of cask ale", par: 3, hazard: null, hazard_note: null, penalties: [], walk_minutes_to_next: 22 },
  { number: 6, venue_name: "The Auld Shillelagh", drink: "Pint of Guinness", par: 6, hazard: "water", hazard_note: "No toilet until the hole is filed — a 3-stroke penalty if you crack", penalties: [{ strokes: 3, reason: "Using the toilet on a water hazard" }], walk_minutes_to_next: 13 },
  { number: 7, venue_name: "Clissold Park Tavern", drink: "Glass of wine", par: 3, hazard: null, hazard_note: null, penalties: [], walk_minutes_to_next: 23 },
  { number: 8, venue_name: "The World's End", drink: "Bomb shot, in one", par: 1, hazard: "bunker", hazard_note: "Down in one — extra swigs count as strokes, and missing it is a 2-stroke penalty", penalties: [{ strokes: 2, reason: "Not down in one" }], walk_minutes_to_next: 2 },
  { number: 9, venue_name: "The Faltering Fullback", drink: "Pint of your choosing", par: 5, hazard: null, hazard_note: null, penalties: [], walk_minutes_to_next: null },
];

/**
 * The same pubs, walked the other way — the 19th becomes the 1st tee.
 *
 * Everything a hole owns (par, drink, hazard, local rules) stays with its
 * pub; only the numbers and the walks move. A walk is the same leg in either
 * direction, and it is stored on the EARLIER hole of its pair — which, after
 * reversing, is the next element along. The new last hole walks nowhere.
 */
export function reverseCourse<
  T extends { number: number; walk_minutes_to_next: number | null },
>(holes: T[]): T[] {
  const reversed = [...holes].reverse();
  return reversed.map((hole, index) => ({
    ...hole,
    number: index + 1,
    walk_minutes_to_next: reversed[index + 1]?.walk_minutes_to_next ?? null,
  }));
}

/** Trim or repeat the template to the requested hole count. */
export function templateForHoleCount(count: number): TemplateHole[] {
  const holes: TemplateHole[] = [];
  for (let index = 0; index < count; index += 1) {
    const source = INVITATIONAL_COURSE[index % INVITATIONAL_COURSE.length];
    // The spread is shallow: without cloning the local rules, a course longer
    // than the template would hand the same array to two holes, and editing
    // one would silently rewrite the other — and the module constant with it.
    holes.push({
      ...source,
      number: index + 1,
      penalties: source.penalties.map((penalty) => ({ ...penalty })),
    });
  }
  if (holes.length > 0) holes[holes.length - 1].walk_minutes_to_next = null;
  return holes;
}
