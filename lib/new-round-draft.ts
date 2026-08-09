/**
 * A half-set table, parked while the host steps out to pay.
 *
 * Buying the green fee means leaving for Stripe's own page and coming back,
 * and the new-round form is the one screen in the app holding state nobody
 * has saved yet. So the draft is written to sessionStorage on the way out
 * and read back on the way in — per tab, which is exactly the life of the
 * trip.
 *
 * Read hydration-safely: `parkedDraft` is the snapshot for a
 * `useSyncExternalStore`, so it caches — returning a fresh object per call
 * would spin React — and the server sees null, which is what keeps the
 * server's HTML and the first client paint identical.
 */

export interface NewRoundDraft {
  name: string;
  holes: number;
  courseId: string | null;
  reversed: boolean;
  format: string;
  toggles: Record<string, boolean>;
  minutesPerPub: number;
  /** ISO date of the advertised first tee, or null when unscheduled. */
  teeDate: string | null;
  teeMinutes: number;
  mulligans: number;
  rules: { strokes: number; reason: string; on: boolean; custom: boolean }[];
}

const KEY = "pub-golf:new-round-draft";

/** Undefined = not yet read; null = nothing parked. */
let cached: NewRoundDraft | null | undefined;

/**
 * Whatever was parked, or null. Never throws and never trusts the store:
 * this is a string a previous build wrote, and a draft that no longer parses
 * is a fresh form rather than a broken screen.
 */
export function parseDraft(raw: string | null): NewRoundDraft | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const draft = parsed as Partial<NewRoundDraft>;
    if (typeof draft.name !== "string" || typeof draft.holes !== "number")
      return null;
    return {
      name: draft.name,
      holes: draft.holes,
      courseId: typeof draft.courseId === "string" ? draft.courseId : null,
      reversed: draft.reversed === true,
      format: typeof draft.format === "string" ? draft.format : "stroke",
      toggles:
        draft.toggles && typeof draft.toggles === "object"
          ? (draft.toggles as Record<string, boolean>)
          : {},
      minutesPerPub:
        typeof draft.minutesPerPub === "number" ? draft.minutesPerPub : 20,
      teeDate: typeof draft.teeDate === "string" ? draft.teeDate : null,
      teeMinutes: typeof draft.teeMinutes === "number" ? draft.teeMinutes : 0,
      mulligans: typeof draft.mulligans === "number" ? draft.mulligans : 0,
      rules: Array.isArray(draft.rules)
        ? draft.rules.filter(
            (rule): rule is NewRoundDraft["rules"][number] =>
              !!rule &&
              typeof rule === "object" &&
              typeof (rule as { reason?: unknown }).reason === "string" &&
              typeof (rule as { strokes?: unknown }).strokes === "number",
          )
        : [],
    };
  } catch {
    return null;
  }
}

/** The `useSyncExternalStore` snapshot — cached, so it is stable per call. */
export function parkedDraft(): NewRoundDraft | null {
  if (cached === undefined) {
    cached =
      typeof sessionStorage === "undefined"
        ? null
        : parseDraft(sessionStorage.getItem(KEY));
  }
  return cached;
}

/** Nothing to subscribe to: the draft is read once, on the way in. */
export function subscribeToDraft(): () => void {
  return () => undefined;
}

export function parkDraft(draft: NewRoundDraft): void {
  cached = draft;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // A private-mode store that refuses writes costs the host their toggles,
    // not their round. Never worth an error on screen.
  }
}

export function clearParkedDraft(): void {
  cached = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Same again: nothing here is worth interrupting a round for.
  }
}
