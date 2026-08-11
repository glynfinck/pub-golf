/**
 * The brief: what the host asks the caddy for.
 *
 * Pure, and deliberately small. Everything here is either a closed menu or a
 * bounded string, because the brief is the one part of the caddy a stranger
 * gets to write and it ends up inside a prompt. The rule that keeps the menus
 * honest is in `PARTICULARS`: **no preference is offered unless the pub
 * dossier carries a signal that can check it** — a chip the caddy cannot
 * verify is a promise the product cannot keep.
 */

/** How many holes the caddy will plan. The card itself allows 1–18
 * (`courseSchema`); these are the four a thumb picks between. */
export const HOLE_CHOICES = [6, 9, 12, 18] as const;
export const DEFAULT_HOLES = 9;

/** Long enough for "one of us is on crutches", short enough to stay a note. */
export const NOTE_MAX = 120;

/**
 * How far apart the pubs should be, as the shortest walk between two of them.
 *
 * Offered because the obvious routing objective — shortest total walk — is
 * subtly wrong for a crawl. Given three pubs on one corner it visits all three
 * back to back, which is the best possible arithmetic and a poor night: the
 * walk between rounds is the part that paces the evening, and three doors in a
 * row is one long session wearing a scorecard.
 *
 * Minutes rather than metres, because minutes is how a group actually thinks
 * about the gap between pints, and it is already the unit the drink timer and
 * the walk estimate speak.
 */
export const STRETCH_CHOICES = [
  { id: 0, label: "Doorstep", meaning: "Whatever's closest, however close." },
  { id: 3, label: "Short", meaning: "A few minutes between doors." },
  { id: 5, label: "Steady", meaning: "About five minutes' walk between pubs." },
  { id: 10, label: "Stretch", meaning: "A proper walk between rounds." },
] as const;

/** Five minutes: long enough to pace the night, short enough that most patches
 * can actually answer it. */
export const DEFAULT_STRETCH = 5;

export function readStretch(value: unknown): number {
  const asked = Number(value);
  return STRETCH_CHOICES.some((choice) => choice.id === asked)
    ? asked
    : DEFAULT_STRETCH;
}

export function stretchMeaning(minutes: number): string {
  return (
    STRETCH_CHOICES.find((choice) => choice.id === minutes)?.meaning ??
    STRETCH_CHOICES.find((choice) => choice.id === DEFAULT_STRETCH)!.meaning
  );
}

/**
 * The round's character — single-select, because a round has one.
 *
 * `meaning` is the line under the chip on screen *and* the line the caddy
 * reads in the prompt. One source: a vibe that means one thing to the player
 * and another to the caddy is the bug this arrangement exists to prevent.
 */
export const VIBES = [
  {
    id: "traditional",
    label: "Traditional",
    meaning: "Old boozers, cask on the card.",
  },
  {
    id: "lively",
    label: "Lively",
    meaning: "Music, crowds, the loud end of town.",
  },
  {
    id: "steady",
    label: "Steady",
    meaning: "Short walks, long sits.",
  },
  {
    id: "punishing",
    label: "Punishing",
    meaning: "The caddy shows no mercy.",
  },
] as const;

export type VibeId = (typeof VIBES)[number]["id"];
export const DEFAULT_VIBE: VibeId = "traditional";

export function readVibe(value: unknown): VibeId {
  const found = VIBES.find((vibe) => vibe.id === value);
  return found ? found.id : DEFAULT_VIBE;
}

export function vibeMeaning(id: VibeId): string {
  return VIBES.find((vibe) => vibe.id === id)?.meaning ?? "";
}

/**
 * The particulars — multi-select, because requirements stack where character
 * does not.
 *
 * `signal` names the dossier field that answers the chip, and it is the whole
 * point of this table. `beer-gardens` reads `outdoorSeating`; `pets` reads
 * `allowsDogs` (Google's signal is dogs, which in pub terms is the
 * pets-welcome pub); `cheap` reads the price level. `no-chains` is the one
 * judgement call, and it says so — it is answered from the reviews the caddy
 * reads rather than from a boolean.
 *
 * A unit test walks this list against `CandidateDossier` and fails if a chip
 * ever names a signal the dossier does not carry.
 */
export const PARTICULARS = [
  { id: "beer-gardens", label: "Beer gardens", signal: "outdoorSeating" },
  { id: "pets", label: "Pets welcome", signal: "allowsDogs" },
  { id: "cheap", label: "Cheap rounds", signal: "priceLevel" },
  { id: "cocktails", label: "Cocktails", signal: "servesCocktails" },
  { id: "live-music", label: "Live music", signal: "liveMusic" },
  { id: "sport", label: "Sport on", signal: "goodForWatchingSports" },
  { id: "big-table", label: "Room for a big table", signal: "goodForGroups" },
  { id: "no-chains", label: "No chains", signal: "reviews" },
] as const;

export type ParticularId = (typeof PARTICULARS)[number]["id"];

export function particularLabel(id: ParticularId): string {
  return PARTICULARS.find((p) => p.id === id)?.label ?? id;
}

/** What the host asked for, once it has been read off the wire. */
export interface CaddyBrief {
  /** The patch, in the host's own words. */
  where: string;
  /** Venue ids of pinned tees, or null. A pin is a real `venues` row before
   * the caddy hears of it — the pub search put it there. */
  startVenueId: string | null;
  finishVenueId: string | null;
  holes: number;
  vibe: VibeId;
  particulars: ParticularId[];
  /** One line, the host's own. Fenced before it reaches the model. */
  note: string;
  /** The shortest walk the host wants between two pubs, in minutes. */
  stretch: number;
}

export const WHERE_MAX = 120;

/**
 * A brief off the wire: bounded, closed-menu, and never trusted.
 *
 * Returns null only when there is nothing to aim at — an empty `where` with no
 * pinned tees. Everything else is clamped rather than refused, because a host
 * who somehow posts `holes: 400` wants nine holes, not an error page.
 */
export function readBrief(raw: unknown): CaddyBrief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;

  const where =
    typeof input.where === "string" ? input.where.trim().slice(0, WHERE_MAX) : "";
  const startVenueId = readId(input.startVenueId);
  const finishVenueId = readId(input.finishVenueId);
  // Nothing to aim at: no patch named and no pin dropped.
  if (!where && !startVenueId && !finishVenueId) return null;

  const asked = Number(input.holes);
  const holes = HOLE_CHOICES.includes(asked as (typeof HOLE_CHOICES)[number])
    ? asked
    : DEFAULT_HOLES;

  const wanted: unknown[] = Array.isArray(input.particulars)
    ? input.particulars
    : [];
  const particulars = PARTICULARS.filter((p) => wanted.includes(p.id)).map(
    (p) => p.id,
  );

  return {
    where,
    startVenueId,
    finishVenueId,
    holes,
    vibe: readVibe(input.vibe),
    stretch: readStretch(input.stretch),
    particulars,
    note: typeof input.note === "string" ? input.note.trim().slice(0, NOTE_MAX) : "",
  };
}

function readId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f-]{36}$/i.test(trimmed) ? trimmed : null;
}

/**
 * How many candidates a brief needs before the caddy will plan at all.
 *
 * Three more than the holes asked for: enough that the caddy is choosing
 * rather than merely listing, and the line below which "not enough pubs round
 * there" is the honest answer instead of a padded card.
 */
export function candidateFloor(holes: number): number {
  return holes + 3;
}
