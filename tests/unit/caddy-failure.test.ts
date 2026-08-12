import { describe, expect, it } from "vitest";

import {
  describeFailure,
  FAILURE_DETAIL_MAX,
  isPermanentFailure,
  REDACTED,
  redactSecrets,
  statusOf,
} from "@/lib/caddy/failure";

describe("redactSecrets", () => {
  it("strips every credential shape this app could have sent", () => {
    // The load-bearing one. This line is about to be written to a log and to a
    // staging screen, and the object it came from has had a key inside it.
    const secrets = [
      "sk-ant-api03-AAAABBBBCCCC",
      "vck_1234567890abcdef",
      "ai_gtw_ZZZZYYYYXXXX",
      "sk_live_51AbCdEf",
      "sk_test_51AbCdEf",
      "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl",
    ];
    secrets.forEach((secret) => {
      const out = redactSecrets(`request failed with ${secret} attached`);
      expect(out).not.toContain(secret);
      expect(out).toContain(REDACTED);
    });
  });

  it("strips a header echoed back in an error body", () => {
    const out = redactSecrets('{"headers":{"x-api-key":"ai_gtw_live_abc"}}');
    expect(out).not.toContain("ai_gtw_live_abc");
  });

  it("leaves an ordinary message alone", () => {
    const plain = "model not found: anthropic/claude-opus-5";
    expect(redactSecrets(plain)).toBe(plain);
  });
});

describe("describeFailure", () => {
  it("reads the shape the SDK throws", () => {
    const detail = describeFailure({
      name: "NotFoundError",
      status: 404,
      message: "model not found",
      request_id: "req_abc123",
    });
    expect(detail).toContain("HTTP 404");
    expect(detail).toContain("model not found");
    expect(detail).toContain("req_abc123");
  });

  it("falls back to a nested error message", () => {
    expect(
      describeFailure({ status: 400, error: { message: "unexpected field" } }),
    ).toContain("unexpected field");
  });

  it("always says something", () => {
    // "No detail" is the outcome this module exists to prevent, so every
    // branch has to produce a line.
    [null, undefined, {}, "boom", 42, new Error("kaboom")].forEach((cause) => {
      expect(describeFailure(cause).length).toBeGreaterThan(0);
    });
    expect(describeFailure(new Error("kaboom"))).toContain("kaboom");
  });

  it("redacts before it returns, whatever the shape", () => {
    const detail = describeFailure({
      status: 401,
      message: "invalid key ai_gtw_supersecret",
    });
    expect(detail).not.toContain("ai_gtw_supersecret");
    expect(detail).toContain("HTTP 401");
  });

  it("stays one line's worth", () => {
    const detail = describeFailure({ status: 500, message: "x".repeat(5_000) });
    expect(detail.length).toBeLessThanOrEqual(FAILURE_DETAIL_MAX);
  });

  it("does not repeat a bare Error name as though it were information", () => {
    expect(describeFailure(new Error("kaboom"))).not.toContain("Error ·");
  });
});

describe("isPermanentFailure", () => {
  it("calls a config refusal permanent", () => {
    // The one that prompted this: the gateway answering 403 because the
    // account cannot reach the model. Asking again will never work, and
    // telling a paying host to try again sits them at a dead button.
    expect(isPermanentFailure({ status: 403 })).toBe(true);
    expect(isPermanentFailure({ status: 401 })).toBe(true);
    expect(isPermanentFailure({ status: 404 })).toBe(true);
    expect(isPermanentFailure({ status: 400 })).toBe(true);
  });

  it("calls a wobble transient", () => {
    [408, 429, 500, 502, 503, 529].forEach((status) =>
      expect(isPermanentFailure({ status })).toBe(false),
    );
  });

  it("treats an unknown shape as transient", () => {
    // The doubt falls this way on purpose: a wrongly-transient message costs
    // one wasted tap, a wrongly-permanent one tells a host the caddy is off
    // duty when it would have worked second time.
    expect(isPermanentFailure(new Error("socket hang up"))).toBe(false);
    expect(isPermanentFailure(null)).toBe(false);
    expect(isPermanentFailure({})).toBe(false);
  });

  it("reads a status given as a string", () => {
    expect(statusOf({ status: "403" })).toBe(403);
    expect(isPermanentFailure({ status: "403" })).toBe(true);
    expect(statusOf({ status: "nonsense" })).toBeNull();
  });
});
