import { describe, expect, it } from "vitest";

import { caddyOnDuty, caddyOpen } from "@/lib/caddy/open";
import { greenFeeOnSale } from "@/lib/billing";

/**
 * The switch that holds the caddy back, and the till that follows it.
 *
 * Worth its own file rather than a line in `caddy-readiness.test.ts` because
 * it is a different kind of rule. Readiness asks whether a deploy *can* run a
 * caddy; this asks whether the house has decided anybody should meet one yet
 * — and the answer has to reach two places that have never had anything to do
 * with each other: the pipeline, and the money.
 *
 * The load-bearing assertion is the last one. `GREEN_FEE_EXTRAS` has exactly
 * one entry and that entry is the caddy, so a fee sold while the caddy is
 * shut is £12 for a coming-soon note. That is the failure this whole change
 * exists to make impossible, and it is a function call, so it is proved here
 * rather than by looking at a screen.
 */

const KEYED = { AI_GATEWAY_API_KEY: "gw", STRIPE_SECRET_KEY: "sk_test" };

describe("caddyOpen", () => {
  it("is shut unless something says otherwise", () => {
    // The direction is the point. A flag you must set to *hide* an unfinished
    // feature ships it the first time an environment is created without it.
    expect(caddyOpen({})).toBe(false);
    expect(caddyOpen({ CADDY_OPEN: undefined })).toBe(false);
    expect(caddyOpen({ CADDY_OPEN: "" })).toBe(false);
  });

  it("takes one word for yes, and trims it", () => {
    expect(caddyOpen({ CADDY_OPEN: "true" })).toBe(true);
    expect(caddyOpen({ CADDY_OPEN: "  true  " })).toBe(true);
  });

  it("treats every other value as no", () => {
    // "1", "yes" and "TRUE" all look like intent and none of them are the
    // documented word. Guessing at them is how a flag ends up meaning
    // something different in two places.
    ["1", "yes", "on", "TRUE", "True", "false", "no"].forEach((value) =>
      expect(caddyOpen({ CADDY_OPEN: value })).toBe(false),
    );
  });
});

describe("caddyOnDuty", () => {
  it("needs the switch and a credential, not either", () => {
    expect(caddyOnDuty({ ...KEYED, CADDY_OPEN: "true" })).toBe(true);
    // Equipped but held back — the new case.
    expect(caddyOnDuty(KEYED)).toBe(false);
    // Open but unequipped — the case that always existed.
    expect(caddyOnDuty({ CADDY_OPEN: "true" })).toBe(false);
  });
});

describe("greenFeeOnSale", () => {
  it("never sells the fee while the caddy is shut", () => {
    // The fee's one extra is the caddy. A live Stripe key is not permission
    // to charge for a thing that will answer "coming soon".
    expect(greenFeeOnSale({ STRIPE_SECRET_KEY: "sk_live" })).toBe(false);
    expect(greenFeeOnSale({ ...KEYED, CADDY_OPEN: "true" })).toBe(true);
  });

  it("still needs a till", () => {
    expect(greenFeeOnSale({ CADDY_OPEN: "true" })).toBe(false);
  });
});
