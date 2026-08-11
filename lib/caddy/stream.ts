import type { PlannedCourse } from "@/lib/caddy/plan";

/**
 * What the caddy says while it is still working, and how that crosses the wire.
 *
 * The plan used to be one server action: twenty seconds of nothing, then a
 * finished card. Everything interesting had already happened by the time the
 * host saw anything — the patch was gathered, forty pubs were read, nine were
 * chosen and a walk was routed through them, and none of it was visible.
 *
 * So the plan streams. This module is the vocabulary and nothing else: pure,
 * shared by the route handler that writes the events and the drafting table
 * that reads them, and unit-tested on both sides of the wire. The transport is
 * NDJSON rather than SSE — one JSON object per line — because the payloads are
 * already JSON and `text/event-stream`'s framing would only be a second
 * encoding to get wrong.
 *
 * **Order is a promise.** `patch` always arrives first and `card` or `failed`
 * always arrives last. Everything between is optional and may not arrive at
 * all, which is the whole point of it being a narration: a reader that ignored
 * every middle event would still get a correct result.
 */
export type CaddyEvent =
  /** The patch, gathered. Every pub the caddy is about to choose from, so the
   * map can frame the neighbourhood before a single hole exists. Carries the
   * candidate id with each pin, which is what lets a later `picked` light one
   * up — the two events are useless apart. */
  | { type: "patch"; pins: { id: string; lat: number; lng: number }[] }
  /** The caddy reasoning, as it reasons. Summarised by the model, never the
   * raw chain of thought — and never load-bearing: it is a window, and a
   * window that stays dark costs nothing but the view. */
  | { type: "thinking"; text: string }
  /** What the caddy is doing right now, in four words — "Looking for beer
   * gardens", "Walking the route". Better narration than raw reasoning: it is
   * the work the host is paying for, named. */
  | { type: "doing"; text: string }
  /** Pubs chosen so far, by candidate id, in the order the caddy named them.
   * Not the walking order — that is decided after the answer is complete
   * (`lib/caddy/route.ts`), which is exactly why these land as pins and the
   * numbers arrive with the finished card. */
  | { type: "picked"; ids: string[] }
  /** The card, routed and dressed. The end of a good run. */
  | { type: "card"; course: PlannedCourse; sessionId: string }
  /** The end of a bad one. `error` is the line the host reads; `detail` is
   * for the staging note and the log, and is never shown to a player. */
  | { type: "failed"; error: string; detail?: string };

/** One event, as a line on the wire. */
export function encodeEvent(event: CaddyEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Pull whole events out of a buffer, and hand back what was left over.
 *
 * A chunk off the network splits wherever TCP felt like splitting it, which is
 * regularly mid-object. The caller keeps `rest` and prepends it to the next
 * chunk; a line that does not parse is dropped rather than thrown, because a
 * narration is not worth failing a plan over.
 */
export function decodeEvents(buffer: string): {
  events: CaddyEvent[];
  rest: string;
} {
  const lines = buffer.split("\n");
  // The last piece is either an empty string (the buffer ended on a newline)
  // or a partial line. Either way it is not ours to parse yet.
  const rest = lines.pop() ?? "";
  const events: CaddyEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as CaddyEvent);
    } catch {
      // A malformed line is a dropped frame of narration, nothing more.
    }
  }
  return { events, rest };
}

/**
 * Which candidates the answer has named so far, read out of a half-written
 * JSON document.
 *
 * A regex rather than an incremental JSON parser, and deliberately so. The
 * thing being looked for is one key with one shape — the schema admits
 * `candidateId` as a string and nothing else can produce that pattern — and a
 * partial-JSON parser would be a few hundred lines of machinery whose failure
 * mode is silently mis-reading a card. This cannot mis-read a card: it is not
 * in the path that builds one. `parsePlan` still reads the finished document,
 * still resolves every id against the dossier, and still drops anything it
 * does not recognise. If this function returned nonsense the worst that
 * happens is a pin lights up early.
 *
 * Ids are returned in the order they appear, deduplicated, so a caller can
 * treat it as "the picks so far" and diff against what it already has.
 */
export function pickedIds(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const pattern = /"candidateId"\s*:\s*"([^"]+)"/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      found.push(id);
    }
    match = pattern.exec(text);
  }
  return found;
}

/**
 * How much of the caddy's thinking to keep on screen.
 *
 * A window, not a transcript. The reasoning runs to thousands of words and
 * nobody is reading it — what it is there for is the difference between a
 * spinner and something visibly working, which the last line provides as well
 * as the whole thing and without turning the drafting table into a log viewer.
 *
 * Sized down from 240 after the first real run overflowed the panel it sits
 * in. Two clamps, not one: this bounds the string and `line-clamp` bounds the
 * box, because a window that depends on how wide somebody's phone is will
 * eventually meet a phone it does not fit.
 */
export const THINKING_WINDOW = 130;

/** The tail of the thinking, tidied for a single line on screen. */
export function thinkingTail(text: string, max = THINKING_WINDOW): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `…${flat.slice(flat.length - max)}`;
}
