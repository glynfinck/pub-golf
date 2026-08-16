/**
 * The caddy's reasoning, read as headlines rather than as a firehose.
 *
 * **What this replaces.** The raw tail of the model's own thinking, clamped to
 * two lines and re-rendered on every token — so the last two lines of a
 * paragraph slid upward continuously, cut mid-word at both ends, and were
 * unreadable by construction: the eye cannot finish a line that is moving.
 * Watching it told you a model was running and nothing else.
 *
 * A thought you can actually read is a *complete* one, held still long enough
 * to finish. So this waits for a sentence to close, trims it to a glanceable
 * length, and hands back one line — which changes only when the next thought
 * completes, never mid-word and never mid-token.
 *
 * Pure, so what the screen shows for a given stream is provable without a
 * browser and without a model: the tier this codebase asks for.
 */

/**
 * Longer than this and it stops being a headline.
 *
 * A headline that reflows is not a headline. At 76 a thought ran to one line or
 * two depending on its wording, so the row changed height every time the caddy
 * finished a sentence and the whole card hopped under the reader's thumb. 64
 * fits one line on the phones almost everybody is holding.
 *
 * It is not a guarantee, and the callers do not treat it as one: at 320px the
 * row is about 50 characters wide, so they pin the row's height and let CSS
 * truncate what is left. Two cuts, deliberately — this one lands on a word
 * boundary and reads as an abbreviation, CSS's lands anywhere and is the safety
 * net under it. What matters is that the height is fixed either way.
 */
export const HIGHLIGHT_MAX = 64;

/**
 * How long a thought stays up before a newer one may take its place.
 *
 * `highlight` waits for a sentence to *close*, which stops the line being cut
 * mid-word — but says nothing about how fast the closes arrive. Dressing nine
 * holes, the caddy finishes short sentences in bursts, and three of them
 * inside a second is a row that flickers: each is legible in isolation and
 * none is on screen long enough to read.
 *
 * Two seconds is about the reading time of a 64-character line. Below that the
 * reader is being shown text they cannot finish, which is the same failure the
 * raw firehose had, just at a slower rate.
 */
export const HOLD_MS = 2000;

/** What the reader is currently looking at, and since when. */
export interface HeldThought {
  line: string | null;
  /** When it went up. Meaningless while `line` is null. */
  since: number;
}

/** Nothing up yet. The caller's initial state. */
export const NOTHING_HELD: HeldThought = { line: null, since: 0 };

export interface ThoughtHold {
  held: HeldThought;
  /**
   * Milliseconds until a waiting thought may take the screen, or null when
   * nothing is waiting. A caller that ignores this shows a stale line; one
   * that polls instead of using it does work for nothing.
   */
  waitMs: number | null;
}

/**
 * What the reader should be looking at now — the pacing, with no clock in it.
 *
 * Returns the **same `held` object** whenever the screen should not change, so
 * a caller can compare by identity and skip the render entirely.
 *
 * Three rules, and each one is a thing that went wrong on screen first:
 *
 *   **A finished thought is never blanked.** A stream that stops mid-sentence
 *   — or ends on one — leaves `highlight` with nothing new to say, and
 *   clearing the row on that reads as the caddy giving up. The last thing it
 *   finished saying stays up.
 *
 *   **The first thought does not wait.** There is nothing on screen for it to
 *   interrupt, so holding it back would just be a blank row with a timer on it.
 *
 *   **A burst is read as its last word.** Where several thoughts complete
 *   inside one hold, the caller comes back after `waitMs` and puts up whatever
 *   is newest *then* — not the one that happened to be waiting when the hold
 *   started. Skipping the middle of a burst is the point: they were never
 *   readable, and queueing them would only move the flicker later.
 */
export function holdThought(
  held: HeldThought,
  raw: string,
  now: number,
  hold = HOLD_MS,
): ThoughtHold {
  const next = highlight(raw);
  if (next === null || next === held.line) return { held, waitMs: null };
  if (held.line === null)
    return { held: { line: next, since: now }, waitMs: null };
  const rest = held.since + hold - now;
  if (rest <= 0) return { held: { line: next, since: now }, waitMs: null };
  return { held, waitMs: rest };
}

/** Sentence enders the model actually writes, plus the em dash it uses as one. */
const CLOSES = /[.!?](?:\s|$)|—\s/g;

/**
 * Markdown, list bullets and the model's own scaffolding.
 *
 * Reasoning arrives with headers, bold runs and numbered steps in it. Rendered
 * literally that is `**Step 3:**` on the glass, which reads as a bug.
 */
function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/[*_#>]+/g, " ")
    .replace(/^\s*\d+[.)]\s*/gm, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Is this a thought, or just a noise the model made?
 *
 * Reasoning is full of one-word acknowledgements — "Good.", "Close.", "Fine.",
 * "Right." — and the old floor let anything past four characters through. That
 * was invisible while a new line replaced the last one immediately; once a
 * thought is *held* for two seconds it matters a great deal, because a filler
 * takes the row and the real sentence behind it waits out the hold.
 *
 * Three *words*, which is about the shortest thing that can carry a subject and
 * say something about it — and words meaning tokens with a letter or a digit in
 * them, so the em dash the model ends clauses with does not count towards its
 * own sentence's keep. `highlight` answers null rather than reaching further
 * back for a better one, so the caller simply keeps the last real thought up,
 * which is what should be on screen anyway.
 */
function isThought(line: string): boolean {
  return (line.match(/[\p{L}\p{N}]+/gu) ?? []).length >= 3;
}

/** Cut at a word, not through one, and only where there is something to cut. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The last thought the caddy has finished having.
 *
 * Null while the first one is still being written — the caller shows its own
 * line then, rather than half a sentence that will change under the reader.
 */
export function highlight(raw: string, max = HIGHLIGHT_MAX): string | null {
  const text = plain(raw);
  if (!text) return null;

  // Where the last completed sentence ends. Anything after it is still being
  // written, so it is not a thought yet.
  let end = -1;
  for (const match of text.matchAll(CLOSES)) {
    end = match.index + match[0].trimEnd().length;
  }
  if (end < 0) return null;

  const done = text.slice(0, end);
  // And where it began: the close before it, or the start.
  let start = 0;
  for (const match of done.slice(0, -1).matchAll(CLOSES)) {
    start = match.index + match[0].length;
  }
  const line = done.slice(start).trim();
  return isThought(line) ? clip(line, max) : null;
}

/**
 * Every finished thought, oldest first.
 *
 * For anywhere that wants the trail rather than the head of it — a transcript,
 * a test, or a ticker that likes to keep the previous line fading out beneath
 * the current one.
 */
export function highlights(raw: string, max = HIGHLIGHT_MAX): string[] {
  const text = plain(raw);
  if (!text) return [];
  const lines: string[] = [];
  let start = 0;
  for (const match of text.matchAll(CLOSES)) {
    const end = match.index + match[0].trimEnd().length;
    const line = text.slice(start, end).trim();
    if (isThought(line)) lines.push(clip(line, max));
    start = match.index + match[0].length;
  }
  return lines;
}
