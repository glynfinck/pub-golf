import { describe, expect, it } from "vitest";

import {
  caddyGates,
  caddyReady,
  showCaddyDiagnostics,
  shutGates,
} from "@/lib/caddy/readiness";

const OPEN = {
  // The house's own switch, on. Every case below is about a deploy that is
  // equipped or not; `caddyOpen` is about whether the house is showing the
  // caddy at all, and it has its own describe block.
  CADDY_OPEN: "true",
  AI_GATEWAY_API_KEY: "gw",
  STRIPE_SECRET_KEY: "sk_test",
  GOOGLE_PLACES_API_KEY: "places",
};

const HOST = {
  signedIn: true,
  anonymous: false,
  hasPass: true,
  tablesPresent: true,
};

describe("caddyReady", () => {
  it("is true with everything in place", () => {
    expect(caddyReady(OPEN, HOST)).toBe(true);
  });

  it("needs a model credential", () => {
    expect(caddyReady({ ...OPEN, AI_GATEWAY_API_KEY: "" }, HOST)).toBe(false);
  });

  it("never shows a guest the caddy", () => {
    // Guests reach this table but never cross the payment boundary.
    expect(caddyReady(OPEN, { ...HOST, anonymous: true })).toBe(false);
    expect(caddyReady(OPEN, { ...HOST, signedIn: false })).toBe(false);
  });

  it("lets a held pass stand in for a closed till", () => {
    // Paid is paid: switching Stripe off must not retract a bought thing.
    const noTill = { ...OPEN, STRIPE_SECRET_KEY: "" };
    expect(caddyReady(noTill, { ...HOST, hasPass: true })).toBe(true);
    expect(caddyReady(noTill, { ...HOST, hasPass: false })).toBe(false);
  });

  it("is shut whenever the house has not opened it", () => {
    // The one gate that outranks equipment: everything else in place, and
    // still no caddy, because it is being finished. Default-shut, so an
    // environment that simply forgets the variable stays quiet.
    expect(caddyReady({ ...OPEN, CADDY_OPEN: undefined }, HOST)).toBe(false);
    expect(caddyReady({ ...OPEN, CADDY_OPEN: "false" }, HOST)).toBe(false);
    // Nothing else counts as yes — not "1", not "yes", not an empty string.
    expect(caddyReady({ ...OPEN, CADDY_OPEN: "1" }, HOST)).toBe(false);
    expect(caddyReady({ ...OPEN, CADDY_OPEN: "" }, HOST)).toBe(false);
    // Trimmed, because a variable pasted into a dashboard often is not.
    expect(caddyReady({ ...OPEN, CADDY_OPEN: " true " }, HOST)).toBe(true);
  });

  it("needs the schema to have caught up", () => {
    expect(caddyReady(OPEN, { ...HOST, tablesPresent: false })).toBe(false);
  });

  it("is not ready without a Places key", () => {
    // This assertion used to run the other way, and the argument for it was
    // decent: a plan that refuses in words tells the host more than a group
    // that silently does not exist. What it missed is that the refusal named
    // nothing. A deploy carrying the model credential but no Places key put a
    // builder on screen that looked ready, took the press, and answered "the
    // caddy isn't on duty here" — the same sentence a missing model key gives,
    // and the same one a refused insert gives. Three causes, one shrug.
    //
    // So the key joins readiness. The host gets absence rather than a dead
    // button, and whoever deployed gets the gate list naming the variable.
    expect(caddyReady({ ...OPEN, GOOGLE_PLACES_API_KEY: "" }, HOST)).toBe(false);
    expect(caddyReady({ ...OPEN, GOOGLE_PLACES_API_KEY: "   " }, HOST)).toBe(false);
  });
});

describe("showCaddyDiagnostics", () => {
  it("is off on production and on everywhere else", () => {
    expect(showCaddyDiagnostics({ VERCEL_ENV: "production" })).toBe(false);
    expect(showCaddyDiagnostics({ VERCEL_ENV: "preview" })).toBe(true);
    // An absent VERCEL_ENV reads as local: a diagnostic wrongly hidden on a
    // laptop costs a minute, one wrongly shown to a player costs the illusion.
    expect(showCaddyDiagnostics({})).toBe(true);
  });
});

describe("shutGates", () => {
  it("is empty when the caddy is ready", () => {
    expect(shutGates(OPEN, HOST)).toEqual([]);
  });

  it("names every gate that is shut, and only those", () => {
    const shut = shutGates({}, { ...HOST, hasPass: false, tablesPresent: false });
    expect(shut.map((gate) => gate.label)).toEqual([
      "The caddy is open",
      "Model credential",
      "A green fee to work under",
      "Caddy tables migrated",
      "Places key",
    ]);
    shut.forEach((gate) => expect(gate.fix.length).toBeGreaterThan(0));
  });

  it("says which door a credential came through, when there is one", () => {
    expect(caddyGates(OPEN, HOST)[1].label).toContain("gateway");
    expect(caddyGates({ ANTHROPIC_API_KEY: "k" }, HOST)[1].label).toContain(
      "anthropic",
    );
  });

  it("names the switch first, so nobody debugs a key that is not the problem", () => {
    // The failure this ordering exists to prevent: everything configured,
    // nothing on screen, and a gate list that opens by talking about API keys.
    const shut = shutGates({ ...OPEN, CADDY_OPEN: undefined }, HOST);
    expect(shut).toHaveLength(1);
    expect(shut[0].label).toBe("The caddy is open");
    expect(shut[0].fix).toContain("CADDY_OPEN=true");
  });

  it("tells a guest something different from a signed-out visitor", () => {
    const guest = shutGates(OPEN, { ...HOST, anonymous: true })[0];
    const out = shutGates(OPEN, { ...HOST, signedIn: false, anonymous: false })[0];
    expect(guest.fix).not.toBe(out.fix);
    expect(guest.fix).toMatch(/guest/i);
  });

  it("leaks no part of any credential's value", () => {
    // It reports presence, which is what observing the feature already tells
    // you. It must never report the thing itself.
    const env = {
      CADDY_OPEN: "true",
      AI_GATEWAY_API_KEY: "gw_secret_value",
      STRIPE_SECRET_KEY: "sk_live_secret",
      GOOGLE_PLACES_API_KEY: "places_secret",
      ANTHROPIC_API_KEY: "sk-ant-secret",
    };
    const text = JSON.stringify(caddyGates(env, HOST));
    ["gw_secret_value", "sk_live_secret", "places_secret", "sk-ant-secret"].forEach(
      (secret) => expect(text).not.toContain(secret),
    );
  });
});
