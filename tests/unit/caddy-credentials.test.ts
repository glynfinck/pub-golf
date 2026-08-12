import { describe, expect, it } from "vitest";

import {
  AI_GATEWAY_BASE_URL,
  CADDY_MODEL,
  CADDY_MODEL_VIA_GATEWAY,
  bareModel,
  caddyCredentials,
  caddyEnabled,
  modelFor,
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

describe("modelFor", () => {
  it("defaults to Sonnet, not the top tier", () => {
    // The task is constrained, schema-held work — choosing nine pubs from
    // forty and dressing them — and output dominates the bill.
    expect(CADDY_MODEL).toBe("claude-sonnet-5");
  });

  it("adds the provider for the gateway and takes it off for Anthropic", () => {
    expect(modelFor({}, "gateway")).toBe(CADDY_MODEL_VIA_GATEWAY);
    expect(modelFor({}, "anthropic")).toBe(CADDY_MODEL);
  });

  it("takes an override", () => {
    // The reason this exists: the gateway gates models by account tier and
    // answers one you cannot reach with a 403, so trying another id must not
    // need a redeploy.
    expect(modelFor({ CADDY_MODEL: "claude-opus-5" }, "gateway")).toBe(
      "anthropic/claude-opus-5",
    );
    expect(modelFor({ CADDY_MODEL: "claude-opus-5" }, "anthropic")).toBe(
      "claude-opus-5",
    );
  });

  it("never double-prefixes an override that already names a provider", () => {
    expect(modelFor({ CADDY_MODEL: "openai/gpt-5.4" }, "gateway")).toBe(
      "openai/gpt-5.4",
    );
    expect(modelFor({ CADDY_MODEL: "anthropic/claude-opus-5" }, "gateway")).toBe(
      "anthropic/claude-opus-5",
    );
  });

  it("ignores a blank override rather than asking for an empty model", () => {
    expect(modelFor({ CADDY_MODEL: "   " }, "gateway")).toBe(CADDY_MODEL_VIA_GATEWAY);
  });

  it("carries the override through credential resolution", () => {
    expect(
      caddyCredentials({ AI_GATEWAY_API_KEY: "k", CADDY_MODEL: "claude-opus-5" })?.model,
    ).toBe("anthropic/claude-opus-5");
    expect(
      caddyCredentials({ ANTHROPIC_API_KEY: "k", CADDY_MODEL: "claude-opus-5" })?.model,
    ).toBe("claude-opus-5");
  });
});

describe("bareModel", () => {
  it("strips one provider prefix and leaves a bare id alone", () => {
    expect(bareModel("anthropic/claude-opus-5")).toBe("claude-opus-5");
    expect(bareModel("claude-opus-5")).toBe("claude-opus-5");
  });
});
