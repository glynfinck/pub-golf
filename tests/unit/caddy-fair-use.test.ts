import { describe, expect, it } from "vitest";

import {
  CADDY_FAIR_USE_NOTE,
  CADDY_FAIR_USE_PER_DAY,
  caddyFairUseSpent,
  caddyTurnsSpent,
} from "@/lib/caddy/fair-use";

const NOW = Date.parse("2026-08-11T20:00:00.000Z");
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

describe("caddyTurnsSpent", () => {
  it("counts the rolling day, not the calendar one", () => {
    const turns = [ago(1), ago(6), ago(23.5), ago(25), ago(400)];
    expect(caddyTurnsSpent(turns, NOW)).toBe(3);
  });

  it("ignores anything unparseable rather than throwing", () => {
    expect(caddyTurnsSpent(["", "not a date", ago(1)], NOW)).toBe(1);
  });

  it("is zero on a fee that has never asked", () => {
    expect(caddyTurnsSpent([], NOW)).toBe(0);
  });
});

describe("caddyFairUseSpent", () => {
  it("lets the cap-th call through and refuses the one after", () => {
    const under = Array.from({ length: CADDY_FAIR_USE_PER_DAY - 1 }, () => ago(1));
    expect(caddyFairUseSpent(under, NOW)).toBe(false);
    expect(caddyFairUseSpent([...under, ago(1)], NOW)).toBe(true);
  });

  it("forgets yesterday's shift", () => {
    const yesterday = Array.from({ length: CADDY_FAIR_USE_PER_DAY }, () => ago(30));
    expect(caddyFairUseSpent(yesterday, NOW)).toBe(false);
  });

  it("sits far enough above honest play to be invisible", () => {
    // A heavy session is a plan, a few rolls and a handful of asks. The
    // backstop is armour against scripts, so it must not be reachable by
    // somebody merely being fussy.
    const heavySession = 12;
    expect(CADDY_FAIR_USE_PER_DAY).toBeGreaterThan(heavySession * 2);
  });

  it("never names a number in the line a host could read", () => {
    expect(CADDY_FAIR_USE_NOTE).not.toMatch(/\d/);
  });
});
