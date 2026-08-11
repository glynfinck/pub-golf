import { describe, expect, it } from "vitest";

import {
  AI_GATEWAY_BASE_URL,
  CADDY_MODEL,
  CADDY_MODEL_VIA_GATEWAY,
  caddyCredentials,
  caddyEnabled,
} from "@/lib/caddy/credentials";

describe("caddyCredentials", () => {
  it("prefers an explicit gateway key over everything else", () => {
    expect(
      caddyCredentials({
        AI_GATEWAY_API_KEY: "gw_live",
        VERCEL_OIDC_TOKEN: "oidc",
        ANTHROPIC_API_KEY: "sk-ant",
      }),
    ).toEqual({
      apiKey: "gw_live",
      baseURL: AI_GATEWAY_BASE_URL,
      model: CADDY_MODEL_VIA_GATEWAY,
      via: "gateway",
    });
  });

  it("falls back to Vercel's OIDC token, as a bearer credential", () => {
    const credentials = caddyCredentials({
      VERCEL_OIDC_TOKEN: "oidc",
      ANTHROPIC_API_KEY: "sk-ant",
    });
    // Bearer, not x-api-key — the gateway documents an OIDC token as one.
    expect(credentials?.authToken).toBe("oidc");
    expect(credentials?.apiKey).toBeUndefined();
    expect(credentials?.via).toBe("gateway");
  });

  it("goes straight to Anthropic when that is all there is", () => {
    expect(caddyCredentials({ ANTHROPIC_API_KEY: "sk-ant" })).toEqual({
      apiKey: "sk-ant",
      model: CADDY_MODEL,
      via: "anthropic",
    });
  });

  it("names the model in the dialect of the door it goes through", () => {
    // The gateway wants the provider on the id; Anthropic does not. Getting
    // this backwards is a 404 at the far end, so it is worth a test.
    expect(CADDY_MODEL_VIA_GATEWAY).toBe(`anthropic/${CADDY_MODEL}`);
    expect(caddyCredentials({ AI_GATEWAY_API_KEY: "k" })?.model).toContain("/");
    expect(caddyCredentials({ ANTHROPIC_API_KEY: "k" })?.model).not.toContain("/");
  });

  it("sends nothing but the default base URL when going direct", () => {
    expect(caddyCredentials({ ANTHROPIC_API_KEY: "k" })?.baseURL).toBeUndefined();
  });

  it("treats blank and whitespace as absent", () => {
    expect(caddyCredentials({})).toBeNull();
    expect(caddyCredentials({ AI_GATEWAY_API_KEY: "   " })).toBeNull();
    expect(
      caddyCredentials({ AI_GATEWAY_API_KEY: "", ANTHROPIC_API_KEY: "sk" })?.via,
    ).toBe("anthropic");
  });
});

describe("caddyEnabled", () => {
  it("is false with no credential at all — no key, no caddy", () => {
    expect(caddyEnabled({})).toBe(false);
  });

  it("is true through any of the three doors", () => {
    expect(caddyEnabled({ AI_GATEWAY_API_KEY: "k" })).toBe(true);
    expect(caddyEnabled({ VERCEL_OIDC_TOKEN: "k" })).toBe(true);
    expect(caddyEnabled({ ANTHROPIC_API_KEY: "k" })).toBe(true);
  });
});
