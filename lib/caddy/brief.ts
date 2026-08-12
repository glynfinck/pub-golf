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
  /**
   * Where the night ends, when it is going somewhere.
   *
   * Empty for a round that stays in one patch, which is most of them. A second
   * area turns the plan from "pubs near here" into a walk across town —
   * Finsbury Park to Broadway Market rather than nine doors off one street —
   * and it is the host's call, because the same two words can mean a gentle
   * crawl or a route march depending on how far apart they are.
   */
  whereTo: string;
  /**
   * How far apart the two areas actually are, resolved before the plan runs.
   *
   * Zero for a single-patch round. When it is set it **outranks `stretch`**,
   * and that is the point rather than a caveat: pace times legs is distance,
   * so a host who asks for a steady five minutes *and* for Covent Garden four
   * kilometres away has asked for two different rounds. The named destination
   * is the concrete one, so it wins and the pace is derived from it.
   *
   * Bounded on the way in — it arrives from the browser, so it is a hint
   * rather than a fact until the gather agrees with it.
   */
  reachKm: number;
  /** Where the two named areas actually resolved to, filled in by the gather.
   * The router needs them: they are what turns the walk's axis from a line
   * into a direction. */
  aimFrom?: { lat: number; lng: number } | null;
  aimTo?: { lat: number; lng: number } | null;
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
  const whereTo =
    typeof input.whereTo === "string" ? input.whereTo.trim().slice(0, WHERE_MAX) : "";
  // Anything past a long day's walk is a typo or a joke, and anything negative
  // is neither. Rounded, because a ring drawn to the metre is false precision.
  const reachKm =
    typeof input.reachKm === "number" && Number.isFinite(input.reachKm)
      ? Math.min(40, Math.max(0, Math.round(input.reachKm * 100) / 100))
      : 0;
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
    // The same patch twice is one patch: a host who picks their own area
    // for both ends wants a tight round, not a walk back to where they began.
    whereTo: whereTo.toLowerCase() === where.toLowerCase() ? "" : whereTo,
    reachKm: whereTo.toLowerCase() === where.toLowerCase() ? 0 : reachKm,
    startVenueId,
    finishVenueId,
    holes,
    vibe: readVibe(input.vibe),
    stretch: readStretch(input.stretch),
    particulars,
    note: typeof input.note === "string" ? input.note.trim().slice(0, NOTE_MAX) : "",
    /**
     * Where the round is aimed, read back off a brief that has already been
     * through a gather.
     *
     * **These were declared and never constructed, so A-to-B routing was dead
     * in production.** `openPlan` resolves both area centres and stamps them
     * onto `caddy_sessions.brief`, and every consumer reads them —
     * `patchBlock`, the loop's own graph, `fallbackBoard`. But this parser
     * built a fresh object literal without the two keys, so every one of them
     * received `undefined`, `nearestTo` never fired, and the walk fell back to
     * the principal eigenvector of the candidate cloud. A round asked to
     * finish in Covent Garden went wherever the cloud was widest.
     *
     * It survived a suite that pins the behaviour hard
     * (`tests/unit/caddy-real-patches.test.ts`, at real coordinates) because
     * those tests hand `aimFrom` straight to `buildRouteGraph`. The algorithm
     * was proven; the seam between the algorithm and the brief was not.
     */
    aimFrom: readPoint(input.aimFrom),
    aimTo: readPoint(input.aimTo),
  };
}

/** A coordinate the server itself resolved, read back. Anything that is not a
 * finite pair is nothing — the router treats a missing aim as "no destination
 * named", which is exactly right for a brief that has not been gathered yet. */
function readPoint(value: unknown): { lat: number; lng: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
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

/**
 * How far apart the two ends leave each leg, and whether to say something.
 *
 * A pure function of the two things the host has already chosen, so the brief
 * screen can warn *before* the fee is spent rather than the card explaining
 * afterwards. Returns null when the round is unremarkable, which is most of
 * them — a warning on every plan is a warning nobody reads.
 *
 * The thresholds are what a walk feels like rather than round numbers. Much
 * under 300m a leg and two "different" areas are the same place, which is
 * worth saying because the host probably meant somewhere else. Over about a
 * kilometre a leg it stops being a crawl and becomes a march between drinks,
 * and eighteen holes of that is a day out.
 */
export function stretchWarning(
  apartKm: number,
  holes: number,
): string | null {
  const legs = Math.max(holes - 1, 1);
  const perLeg = apartKm / legs;
  if (perLeg > 1.1) {
    return `Those are about ${apartKm.toFixed(1)}km apart, so ${holes} holes means roughly ${Math.round(perLeg * 1000)}m between drinks. That is a proper walk — fewer holes or closer ends will keep it a crawl.`;
  }
  if (apartKm > 0.15 && perLeg < 0.2) {
    return `Those are close enough to be one patch, so this will play as a tight round rather than a walk across town.`;
  }
  return null;
}

/**
 * The pace a destination forces, in minutes between pubs.
 *
 * The inverse of `targetKmFor`, and it exists because the host is offered two
 * controls that set one number. Pace times legs is distance: "steady" over
 * nine holes is about three kilometres, so a round that also has to reach
 * Covent Garden four kilometres away cannot be steady — one of the two has to
 * give, and it should be the abstract one rather than the place they named.
 *
 * So when a destination is set this is what the pace *becomes*, and the screen
 * shows it rather than asking. Nothing is silently overridden; the host sees
 * the number change and can shorten the walk by adding holes or moving the
 * finish, both of which are honest levers.
 */
export function paceForReach(reachKm: number, holes: number): number {
  const legs = Math.max(holes - 1, 1);
  // 4.5 km/h, the stroll the rest of the app estimates walks at.
  return Math.round(((reachKm / legs) / 4.5) * 60);
}

/** How the derived pace reads on screen, in the voice the chips use. */
export function paceNote(minutes: number): string {
  if (minutes <= 0) return "Whatever's closest.";
  if (minutes === 1) return "About a minute between pubs.";
  return `About ${minutes} minutes' walk between pubs.`;
}
