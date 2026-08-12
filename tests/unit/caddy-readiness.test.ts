import { describe, expect, it } from "vitest";

import {
  caddyGates,
  caddyReady,
  showCaddyDiagnostics,
  shutGates,
} from "@/lib/caddy/readiness";

const OPEN = {
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
      "Model credential",
      "A green fee to work under",
      "Caddy tables migrated",
      "Places key",
    ]);
    shut.forEach((gate) => expect(gate.fix.length).toBeGreaterThan(0));
  });

  it("says which door a credential came through, when there is one", () => {
    expect(caddyGates(OPEN, HOST)[0].label).toContain("gateway");
    expect(caddyGates({ ANTHROPIC_API_KEY: "k" }, HOST)[0].label).toContain("anthropic");
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
