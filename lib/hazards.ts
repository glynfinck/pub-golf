/**
 * The three hazards, in the only sense that matters at a pub.
 *
 * Golf's names were borrowed for the shape of the trouble they cause, not
 * for scenery — and until this module existed the mapping lived nowhere but
 * the Invitational's own hazard_notes, which meant a host picking "Dogleg"
 * from a chip in the course builder was choosing a word, not a rule, and
 * their players read a label that explained nothing. One definition, read
 * by the builder when a hazard is chosen and by the rules sheet when it is
 * being played.
 *
 * A hole's own `hazard_note` is the local wording on top of this — the
 * Invitational's dogleg passes drinks one place LEFT, which is its business,
 * not the hazard's.
 */

export type HazardId = "water" | "bunker" | "dogleg";

export interface Hazard {
  id: HazardId;
  label: string;
  /** What the hazard does to the drinker, in one line. */
  meaning: string;
  /** The offence it exists to price, matching the house penalty table. */
  offence: string;
  /**
   * May this hazard sit on the final hole?
   *
   * Only water may not, and the reason is what actually happens at the end of
   * a crawl: the group stops walking and settles in. Water is the one hazard
   * whose relief is deferred — the toilet is out of bounds *until the hole is
   * filed* — so on a hole nobody ever leaves it stops being a forfeit and
   * becomes an hour of discomfort. Bunker and dogleg both resolve on the
   * drink itself, so they make perfectly good finales.
   *
   * Enforced in `parsePlan` rather than only asked for in the prompt, because
   * the caddy cannot know which hole ends up last: the walking order is
   * decided after it answers (`lib/caddy/route.ts`).
   */
  onFinalHole: boolean;
}

export const HAZARDS: Hazard[] = [
  {
    id: "water",
    label: "Water",
    meaning:
      "The toilet is out of bounds until the hole is filed — hold it, or take the penalty.",
    offence: "Using the toilet on a water hazard",
    onFinalHole: false,
  },
  {
    id: "bunker",
    label: "Bunker",
    meaning:
      "Down in one. Every swig after the first is another stroke on your card — a bunker is a hole you get out of, not one you sip.",
    offence: "Not down in one",
    onFinalHole: true,
  },
  {
    id: "dogleg",
    label: "Dogleg",
    meaning:
      "You do not drink what you ordered. Everyone hands their glass to the player on their left, and plays whatever arrives.",
    offence: "Drinking before the pass is complete",
    onFinalHole: true,
  },
];

const BY_ID = new Map(HAZARDS.map((hazard) => [hazard.id, hazard]));

/** The hazard a hole carries, or undefined for a hole that carries none. */
export function readHazard(value: string | null | undefined) {
  return value ? BY_ID.get(value as HazardId) : undefined;
}

export interface HazardInPlay {
  hazard: Hazard;
  /** The holes carrying it, in playing order. */
  holeNumbers: number[];
}

/**
 * The hazards this course actually carries, in the house order rather than
 * the order the holes happen to fall in — the sheet reads the same way on
 * every course, and a hazard nobody is playing never gets a line.
 */
export function hazardsOn(
  holes: { number: number; hazard: string | null }[],
): HazardInPlay[] {
  return HAZARDS.flatMap((hazard) => {
    const holeNumbers = holes
      .filter((hole) => hole.hazard === hazard.id)
      .map((hole) => hole.number)
      .sort((a, b) => a - b);
    return holeNumbers.length > 0 ? [{ hazard, holeNumbers }] : [];
  });
}
