/**
 * Course templates seed a new round's holes until the map-based course
 * builder (Google Places) lands. The flagship template is the printed
 * Glyn Invitational card.
 */

export interface TemplateHole {
  number: number;
  venue_name: string;
  drink: string;
  par: number;
  hazard: "water" | "bunker" | "dogleg" | null;
  hazard_note: string | null;
  walk_minutes_to_next: number | null;
}

export const INVITATIONAL_COURSE: TemplateHole[] = [
  { number: 1, venue_name: "Cat & Mutton", drink: "Pint of lager", par: 5, hazard: null, hazard_note: null, walk_minutes_to_next: 8 },
  { number: 2, venue_name: "Pub on the Park", drink: "Bottle of cider", par: 4, hazard: null, hazard_note: null, walk_minutes_to_next: 12 },
  { number: 3, venue_name: "The Pembury Tavern", drink: "Pint of Five Points", par: 5, hazard: "dogleg", hazard_note: "Drinks pass one place left before anyone starts", walk_minutes_to_next: 14 },
  { number: 4, venue_name: "The Clapton Hart", drink: "Pint of craft", par: 4, hazard: null, hazard_note: null, walk_minutes_to_next: 7 },
  { number: 5, venue_name: "Crooked Billet", drink: "Pint of cask ale", par: 3, hazard: null, hazard_note: null, walk_minutes_to_next: 22 },
  { number: 6, venue_name: "The Auld Shillelagh", drink: "Pint of Guinness", par: 6, hazard: "water", hazard_note: "No toilet for the whole hole — two strokes if you crack", walk_minutes_to_next: 13 },
  { number: 7, venue_name: "Clissold Park Tavern", drink: "Glass of wine", par: 3, hazard: null, hazard_note: null, walk_minutes_to_next: 23 },
  { number: 8, venue_name: "The World's End", drink: "Bomb shot, in one", par: 1, hazard: "bunker", hazard_note: "Down in one, or play it again to get out", walk_minutes_to_next: 2 },
  { number: 9, venue_name: "The Faltering Fullback", drink: "Pint of your choosing", par: 5, hazard: null, hazard_note: null, walk_minutes_to_next: null },
];

/** Trim or repeat the template to the requested hole count. */
export function templateForHoleCount(count: number): TemplateHole[] {
  const holes: TemplateHole[] = [];
  for (let index = 0; index < count; index += 1) {
    const source = INVITATIONAL_COURSE[index % INVITATIONAL_COURSE.length];
    holes.push({ ...source, number: index + 1 });
  }
  if (holes.length > 0) holes[holes.length - 1].walk_minutes_to_next = null;
  return holes;
}
