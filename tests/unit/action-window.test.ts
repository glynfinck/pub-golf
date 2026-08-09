import { describe, expect, it } from "vitest";

import {
  ACTION_NAV_HOLD_MS,
  ACTION_QUIET_CAP_MS,
  ACTION_QUIET_TAIL_MS,
  actionNavigating,
  actionSettled,
  actionStarted,
  refreshQuietUntil,
} from "@/lib/action-window";

/** Module state on purpose — each test re-stamps it, so order is free. */
describe("the action quiet window", () => {
  const T0 = 5_000_000;

  it("opens a capped window when an action starts, so a hung action never mutes the round for good", () => {
    actionStarted(T0);
    expect(refreshQuietUntil()).toBe(T0 + ACTION_QUIET_CAP_MS);
  });

  it("shrinks to a short tail when the action settles — just long enough for our own write's echo", () => {
    actionStarted(T0);
    actionSettled(T0 + 900);
    expect(refreshQuietUntil()).toBe(T0 + 900 + ACTION_QUIET_TAIL_MS);
    expect(ACTION_QUIET_TAIL_MS).toBeLessThan(ACTION_QUIET_CAP_MS);
  });

  it("a fresh action re-opens the window over a stale tail", () => {
    actionSettled(T0);
    actionStarted(T0 + 100);
    expect(refreshQuietUntil()).toBe(T0 + 100 + ACTION_QUIET_CAP_MS);
  });
});

/**
 * The navigation hold. Tracked apart from the action's own window because
 * a push outlives the action that started it.
 */
describe("holding refreshes across a route change", () => {
  const T0 = 7_000_000;

  it("survives the action settling — the push is still in flight", () => {
    // The bug this exists for: reopenHole settles, actionSettled shrinks
    // the window to 750ms, and the deferred refresh lands mid-push and
    // cancels it. The caddy ends up back on the marker's card.
    actionStarted(T0);
    actionNavigating(T0 + 100);
    actionSettled(T0 + 120);
    expect(refreshQuietUntil()).toBe(T0 + 100 + ACTION_NAV_HOLD_MS);
  });

  it("covers a route change for longer than an action's own tail", () => {
    expect(ACTION_NAV_HOLD_MS).toBeGreaterThan(ACTION_QUIET_TAIL_MS);
    expect(ACTION_NAV_HOLD_MS).toBeLessThan(ACTION_QUIET_CAP_MS);
  });

  it("never shortens a longer window already open", () => {
    actionStarted(T0);
    actionNavigating(T0);
    expect(refreshQuietUntil()).toBe(T0 + ACTION_QUIET_CAP_MS);
  });

  it("lets refreshes resume once the navigation has had its beat", () => {
    actionNavigating(T0);
    actionSettled(T0);
    expect(refreshQuietUntil()).toBeLessThanOrEqual(T0 + ACTION_NAV_HOLD_MS);
  });
});
