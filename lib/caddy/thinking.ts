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

/** Longer than this and it stops being a headline. */
export const HIGHLIGHT_MAX = 76;

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
  // A bare "Yes." or a stray fragment is not worth a row of its own.
  return line.length < 4 ? null : clip(line, max);
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
    if (line.length >= 4) lines.push(clip(line, max));
    start = match.index + match[0].length;
  }
  return lines;
}
