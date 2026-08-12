import { describe, expect, it } from "vitest";

import {
  EMPTY_TRACE,
  TRACE_MAX_BYTES,
  TRACE_MAX_CALLS,
  trimTrace,
  type CaddyTrace,
} from "@/lib/caddy/trace";
import { CADDY_TOOLS } from "@/lib/caddy/tools";

/**
 * The audit row, and the rule that makes it safe to keep.
 *
 * A trace exists so that "this course is wrong" has an answer. It records what
 * the caddy *did* — which tools, in what order, which pub on hole four, which
 * ones ruled out — where `caddy_turns` previously recorded only what a turn
 * cost.
 *
 * The rule it lives under is one line: **inputs, never replies.** A tool call
 * is the caddy's decision; a tool result is mostly Google's data, which this
 * app holds for one conversation and then sweeps. A permanent audit row
 * carrying tool replies would undo that retention rule in the one table nobody
 * thinks of as holding Google's data.
 */

function call(over: Partial<CaddyTrace["calls"][number]> = {}) {
  return { name: "set_hole", input: { hole: 1, candidateId: "p1" }, replyBytes: 40, ...over };
}

function traceOf(calls: CaddyTrace["calls"]): CaddyTrace {
  return { ...EMPTY_TRACE, turns: 1, stopReason: "end_turn", calls };
}

describe("what a trace is allowed to carry", () => {
  it("holds a reply's size and never a reply", () => {
    // The whole retention argument, as a type-level fact: there is nowhere in
    // a traced call to put the text of an answer. If a `reply` field ever
    // appears here, the sweep in lib/caddy/window.ts has been quietly undone.
    const one = call();
    expect(Object.keys(one).sort()).toEqual(["input", "name", "replyBytes"]);
    expect(one).not.toHaveProperty("reply");
  });

  it("names pubs only by an id the server minted", () => {
    // Every tool input is checked against this allowlist by
    // tests/unit/caddy-tools.test.ts, so a trace of those inputs cannot carry
    // a venue name either. Restated here because the *reason* differs: there
    // it is "the caddy must never invent a pub", here it is "an audit row must
    // not become a second copy of Google's data".
    const names = CADDY_TOOLS.flatMap((tool) =>
      Object.keys(tool.input_schema.properties ?? {}),
    );
    for (const banned of ["venueName", "venue", "address", "placeId", "name_of_pub"]) {
      expect(names).not.toContain(banned);
    }
  });
});

describe("keeping a trace small enough to store", () => {
  it("leaves an ordinary plan alone", () => {
    const trace = traceOf(Array.from({ length: 12 }, () => call()));
    const trimmed = trimTrace(trace);
    expect(trimmed.calls).toHaveLength(12);
    expect(trimmed.dropped).toBeUndefined();
  });

  it("keeps the end of a runaway, not the start", () => {
    // A loop that went wrong went wrong at the end — the opening calls are the
    // same every plan makes. Keeping the head would throw away the evidence.
    const many = Array.from({ length: TRACE_MAX_CALLS + 40 }, (_, i) =>
      call({ input: { hole: i } }),
    );
    const trimmed = trimTrace(traceOf(many));
    expect(trimmed.calls).toHaveLength(TRACE_MAX_CALLS);
    expect(trimmed.dropped).toBe(40);
    expect(trimmed.calls.at(-1)!.input).toEqual({ hole: TRACE_MAX_CALLS + 39 });
  });

  it("says how many it dropped rather than losing them quietly", () => {
    // A trimmed trace read as a complete one is worse than no trace: it would
    // say the caddy made twelve calls when it made two hundred.
    const trimmed = trimTrace(
      traceOf(Array.from({ length: TRACE_MAX_CALLS + 1 }, () => call())),
    );
    expect(trimmed.dropped).toBeGreaterThan(0);
  });

  it("fits the bound the database enforces", () => {
    // The CHECK in 20260910000000 refuses anything bigger, and a refused
    // insert costs the host their card — so this side has to be the one that
    // gives way. Long local rules are the realistic way to blow the size
    // without blowing the count.
    const fat = Array.from({ length: 60 }, () =>
      call({
        name: "set_hole",
        input: {
          hole: 1,
          candidateId: "p1",
          localRules: [{ reason: "x".repeat(400), strokes: 1 }],
        },
      }),
    );
    const trimmed = trimTrace(traceOf(fat));
    expect(JSON.stringify(trimmed).length).toBeLessThanOrEqual(TRACE_MAX_BYTES);
    expect(trimmed.dropped).toBeGreaterThan(0);
  });

  it("gives up the calls rather than the row when one call is enormous", () => {
    // A single tool input past the whole budget. An empty call list with the
    // count kept is more honest than a row Postgres will refuse.
    const huge = traceOf([call({ input: { note: "x".repeat(TRACE_MAX_BYTES * 2) } })]);
    const trimmed = trimTrace(huge);
    expect(JSON.stringify(trimmed).length).toBeLessThanOrEqual(TRACE_MAX_BYTES);
    expect(trimmed.calls).toHaveLength(0);
    expect(trimmed.dropped).toBe(1);
  });

  it("keeps the facts that are not calls, whatever it trims", () => {
    // Turns, stop reason, candidate count, exclusions and the fallback flag are
    // the cheap half and the half that answers most questions. Trimming must
    // never reach them.
    const trace: CaddyTrace = {
      turns: 7,
      stopReason: "clock",
      calls: Array.from({ length: TRACE_MAX_CALLS + 5 }, () => call()),
      candidates: 41,
      excluded: { p3: "no garden" },
      fallback: true,
    };
    const trimmed = trimTrace(trace);
    expect(trimmed.turns).toBe(7);
    expect(trimmed.stopReason).toBe("clock");
    expect(trimmed.candidates).toBe(41);
    expect(trimmed.excluded).toEqual({ p3: "no garden" });
    expect(trimmed.fallback).toBe(true);
  });

  it("survives a turn that called nothing at all", () => {
    // The single-call plan is the healthy case now, and a plan that drafted
    // straight from the routes block calls no tools worth tracing.
    const trimmed = trimTrace({ ...EMPTY_TRACE, turns: 1, stopReason: "end_turn" });
    expect(trimmed.calls).toEqual([]);
    expect(trimmed.dropped).toBeUndefined();
    expect(JSON.stringify(trimmed).length).toBeLessThan(TRACE_MAX_BYTES);
  });
});
