/**
 * What the caddy did, kept so it can be answered for later.
 *
 * `caddy_turns` already records what a turn *cost* — the model, the tokens,
 * the money. What it has never recorded is what the caddy actually **did**:
 * which tools it reached for, in what order, which pub it put on hole four and
 * which ones it ruled out on the way. So when a host says "this course is
 * wrong", the only evidence is the card at the end, and the reasoning that
 * produced it is gone.
 *
 * That is the feedback loop this closes. A report filed from the drafting
 * table carries its session id, the session's turns carry their traces, and
 * "why did it choose that" becomes a question with an answer rather than a
 * re-run and a guess.
 *
 * ## The rule that makes this safe to keep: inputs, never replies
 *
 * A tool *call* is the caddy's decision. A tool *result* is mostly Google's
 * data — `searchResultBlock`, `boardBlock` and `routesBlock` are all built out
 * of pub names, editorial lines and review snippets, which the house holds for
 * the length of one conversation and sweeps (`lib/caddy/window.ts`). Copying
 * them into a permanent audit row would quietly undo that, and would do it in
 * the one table nobody thinks of as holding Google's data.
 *
 * So a trace stores the **inputs** and the *size* of each reply, and nothing
 * else. That turns out to lose almost nothing worth having:
 *
 *   Every pub is referenced by candidate id, and a candidate id resolves to a
 *   `venues` row, which the app keeps permanently anyway as the shared Places
 *   cache. So a trace read months later still names real pubs — it just reads
 *   them from the place they were always kept.
 *
 *   A reply's length answers the question its content would: a `set_hole` that
 *   changed nothing, a search that found nobody, a route block with no routes
 *   in it. Those are the failures worth catching, and they are all visible in
 *   a byte count.
 *
 * Everything else in a trace — the drinks, the pars, the hazards, the reason a
 * pub was excluded — is the model's own output rather than Google's, and is
 * already stored in `result` when it reaches the card.
 */

/** One tool call, as the audit sees it. */
export interface TracedCall {
  /** The tool's registered name. */
  name: string;
  /**
   * What the caddy passed. The decision, and safe to keep: no tool anywhere
   * accepts a pub's name, so every venue in here is an id of ours.
   */
  input: unknown;
  /**
   * How long the answer was. Never the answer itself — see the module note.
   * Zero is not possible (every reply is a sentence); small is the interesting
   * case, because that is a refusal or an empty result.
   */
  replyBytes: number;
  /** Whether a draft tool actually changed the board. False here on a call
   * that reported success and moved nothing is the exact shape of the bug that
   * once cost an evening's debugging. */
  changed?: boolean;
}

export interface CaddyTrace {
  /** How many model turns the loop took. One is the healthy case. */
  turns: number;
  /** How the model stopped: `end_turn`, `max_tokens`, or the loop's own reason
   * — `clock`, `breaker`, `overran`. */
  stopReason: string;
  calls: TracedCall[];
  /** How many pubs were on the table, so a thin patch is visible afterwards. */
  candidates: number;
  /** Ids the caddy ruled out, with the reason it gave. Its own words. */
  excluded: Record<string, string>;
  /** Whether the loop drafted nothing and the precomputed route was handed
   * over instead. A card that looks fallback-shaped is a card to investigate. */
  fallback: boolean;
}

export const EMPTY_TRACE: CaddyTrace = {
  turns: 0,
  stopReason: "none",
  calls: [],
  candidates: 0,
  excluded: {},
  fallback: false,
};

/**
 * The trace column is bounded, so a runaway loop cannot write a megabyte of
 * audit into a row nobody will read. Matched by a CHECK in the migration:
 * the database refuses what this fails to trim, and a refused insert would
 * cost the host their card.
 */
export const TRACE_MAX_CALLS = 120;
export const TRACE_MAX_BYTES = 16_000;

/**
 * A trace small enough to store, trimmed from the front of the tail.
 *
 * The *last* calls are kept when there are too many, because a loop that went
 * wrong went wrong at the end — the early calls are the same opening every
 * plan makes. `dropped` is recorded rather than silently losing them, so
 * nobody reads a trimmed trace as a complete one.
 */
export function trimTrace(trace: CaddyTrace): CaddyTrace & { dropped?: number } {
  const dropped = Math.max(0, trace.calls.length - TRACE_MAX_CALLS);
  let trimmed: CaddyTrace & { dropped?: number } = dropped
    ? { ...trace, calls: trace.calls.slice(-TRACE_MAX_CALLS), dropped }
    : { ...trace };

  // Belt and braces on the byte bound: a handful of calls carrying long local
  // rules can pass the count and fail the size. Halve until it fits rather
  // than dropping one at a time — this runs on a path a host is waiting on.
  while (
    JSON.stringify(trimmed).length > TRACE_MAX_BYTES &&
    trimmed.calls.length > 1
  ) {
    const keep = Math.floor(trimmed.calls.length / 2);
    trimmed = {
      ...trimmed,
      calls: trimmed.calls.slice(-keep),
      dropped: (trimmed.dropped ?? 0) + (trimmed.calls.length - keep),
    };
  }
  // One enormous call is still possible. An empty list with the count kept is
  // more honest than a row the database will refuse.
  if (JSON.stringify(trimmed).length > TRACE_MAX_BYTES) {
    trimmed = {
      ...trimmed,
      calls: [],
      dropped: (trimmed.dropped ?? 0) + 1,
    };
  }
  return trimmed;
}
