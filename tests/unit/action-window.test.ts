import { describe, expect, it } from "vitest";

import {
  ACTION_QUIET_CAP_MS,
  ACTION_QUIET_TAIL_MS,
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
