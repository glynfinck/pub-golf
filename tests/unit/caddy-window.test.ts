import { describe, expect, it } from "vitest";

import {
  RESUMABLE_HOURS,
  patchIsOpen,
  resumableSince,
} from "@/lib/caddy/window";

/**
 * When a caddy conversation is still open, and whether there is a patch to
 * talk about.
 *
 * Two facts, in one module, because two layers have to agree on each of them —
 * and both of the bugs this file exists for were the layers disagreeing.
 *
 *   The screen offered a session to resume and the pipeline then refused it,
 *   because saving a course emptied the dossier while every other column went
 *   on saying the session was live. A host who had just paid for sixty tweaks
 *   found the ask box answered "That patch has been put away" to everything.
 *
 * A shared predicate cannot be got wrong in only one place, which is the whole
 * argument for these being functions rather than two inline conditions.
 */

const HOUR = 3_600_000;
/** A fixed instant. No clock in a unit test — house rule, and the reason these
 * functions take `now` rather than reading it. */
const NOW = Date.parse("2026-08-12T21:00:00.000Z");

describe("how long a conversation stays open", () => {
  it("cuts off exactly one window back", () => {
    expect(resumableSince(NOW)).toBe(
      new Date(NOW - RESUMABLE_HOURS * HOUR).toISOString(),
    );
  });

  it("covers a night out", () => {
    // The window is the green fee's own day. A round planned before going out
    // must still be tweakable from the pub, which is the case that decides
    // this number rather than any tidiness argument.
    expect(RESUMABLE_HOURS).toBeGreaterThanOrEqual(8);
  });

  it("is a window rather than a cupboard", () => {
    // A session still open a week later is not a conversation, and the dossier
    // is Google's data held for the length of one.
    expect(RESUMABLE_HOURS).toBeLessThan(24);
  });

  it("sorts against a timestamp the way Postgres compares them", () => {
    // Both callers hand this straight to PostgREST as a `created_at` bound, so
    // what matters is that it is an ISO instant that orders correctly as text.
    const since = resumableSince(NOW);
    const older = new Date(NOW - (RESUMABLE_HOURS + 1) * HOUR).toISOString();
    const newer = new Date(NOW - (RESUMABLE_HOURS - 1) * HOUR).toISOString();
    expect(older < since).toBe(true);
    expect(newer > since).toBe(true);
  });
});

describe("whether there is still a patch", () => {
  it("says yes to a gathered patch", () => {
    expect(patchIsOpen([{ id: "p1" }])).toBe(true);
  });

  it("says no to a swept one", () => {
    // The exact shape `closeCaddySession` used to leave behind on every save,
    // and the shape the sweep still leaves once the window has passed.
    expect(patchIsOpen([])).toBe(false);
  });

  it("says no to a column that never had one", () => {
    // A jsonb column reads back as whatever is in it. None of these are a
    // patch, and each of them reached this predicate as `unknown` for exactly
    // that reason.
    expect(patchIsOpen(null)).toBe(false);
    expect(patchIsOpen(undefined)).toBe(false);
    expect(patchIsOpen({})).toBe(false);
    expect(patchIsOpen("[]")).toBe(false);
    expect(patchIsOpen(0)).toBe(false);
  });
});
