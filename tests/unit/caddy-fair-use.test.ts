import { describe, expect, it } from "vitest";

import { CADDY_GRANT_SIZE } from "@/lib/caddy/credits";
import {
  CADDY_FAIR_USE_NOTE,
  CADDY_FAIR_USE_PER_DAY,
} from "@/lib/caddy/fair-use";

/**
 * Fair use is armour against a script, not a second allowance.
 *
 * The tests that used to live here exercised two functions mirroring the
 * trigger's arithmetic, and neither was ever called — the trigger counts, in
 * the only place a count can be trusted, and the app reads its `42501`. What
 * is left is the pair of properties that actually matter about this ceiling,
 * one of which had been silently false for a release.
 */
describe("the fair-use backstop", () => {
  it("sits above everything a fee can buy, not through the middle of it", () => {
    // The bug this replaces a mirror test for. The cap was 25 while a green
    // fee grants 1 + 4 + 60 = 65 turns inside a 24-hour day — so a host who
    // teed off and worked their card could not reach more than a third of
    // what they had paid for, and the refusal they met said "the caddy's done
    // a full shift", which is not what had happened.
    const boughtInADay =
      CADDY_GRANT_SIZE.course + CADDY_GRANT_SIZE.redesign + CADDY_GRANT_SIZE.tweak;
    expect(CADDY_FAIR_USE_PER_DAY).toBeGreaterThan(boughtInADay);
  });

  it("never names a number in the line a host could read", () => {
    // The feature has never shown a count, and the moment of refusal is the
    // first and worst time to start.
    expect(CADDY_FAIR_USE_NOTE).not.toMatch(/\d/);
  });

  it("names the free way on, because there always is one", () => {
    expect(CADDY_FAIR_USE_NOTE).toMatch(/free/i);
  });
});
