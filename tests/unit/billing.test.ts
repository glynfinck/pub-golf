import { describe, expect, it } from "vitest";

import {
  billingEnabled,
  greenFeeSessionParams,
  honestyBoxHref,
} from "@/lib/billing";

describe("billingEnabled", () => {
  it("is off without a key, on with one", () => {
    expect(billingEnabled(undefined)).toBe(false);
    expect(billingEnabled("")).toBe(false);
    expect(billingEnabled("sk_test_x")).toBe(true);
  });
});

describe("honestyBoxHref", () => {
  it("is nothing without the link — the phase-one flag", () => {
    expect(honestyBoxHref(undefined, "GLYN29")).toBeNull();
    expect(honestyBoxHref("", "GLYN29")).toBeNull();
  });

  it("carries the round code as client_reference_id", () => {
    expect(honestyBoxHref("https://buy.stripe.com/abc", "GLYN29")).toBe(
      "https://buy.stripe.com/abc?client_reference_id=GLYN29",
    );
  });

  it("joins with & when the link already has a query", () => {
    expect(
      honestyBoxHref("https://buy.stripe.com/abc?locale=en", "GLYN29"),
    ).toBe("https://buy.stripe.com/abc?locale=en&client_reference_id=GLYN29");
  });

  it("strips anything Stripe would refuse in a reference", () => {
    expect(honestyBoxHref("https://buy.stripe.com/abc", "GL YN/29")).toBe(
      "https://buy.stripe.com/abc?client_reference_id=GLYN29",
    );
  });
});

describe("greenFeeSessionParams", () => {
  const params = greenFeeSessionParams({
    priceId: "price_123",
    roundId: "round-uuid",
    roundCode: "GLYN29",
    userId: "user-uuid",
    origin: "https://pub-golf.glyn.dev",
  });

  it("is a one-off payment for exactly one green fee", () => {
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([{ price: "price_123", quantity: 1 }]);
  });

  it("carries the fulfilment contract in metadata", () => {
    // The webhook trusts nothing but this: what it reads back out of the
    // session is exactly what the entitlement row becomes.
    expect(params.metadata).toEqual({
      kind: "green_fee",
      round_id: "round-uuid",
      round_code: "GLYN29",
      user_id: "user-uuid",
    });
  });

  it("returns to the round either way", () => {
    expect(params.success_url).toBe(
      "https://pub-golf.glyn.dev/round/GLYN29?fee=paid",
    );
    expect(params.cancel_url).toBe("https://pub-golf.glyn.dev/round/GLYN29");
  });
});
