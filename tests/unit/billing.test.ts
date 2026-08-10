import { describe, expect, it } from "vitest";

import {
  billingEnabled,
  DAY_PASS_HOURS,
  dayPassExpiry,
  dayPassLive,
  dayPassSessionParams,
  GREEN_FEE_EXTRAS,
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
    expect(honestyBoxHref(undefined, "TAVERN")).toBeNull();
    expect(honestyBoxHref("", "TAVERN")).toBeNull();
  });

  it("carries the round code as client_reference_id", () => {
    expect(honestyBoxHref("https://buy.stripe.com/abc", "TAVERN")).toBe(
      "https://buy.stripe.com/abc?client_reference_id=TAVERN",
    );
  });

  it("joins with & when the link already has a query", () => {
    expect(
      honestyBoxHref("https://buy.stripe.com/abc?locale=en", "TAVERN"),
    ).toBe("https://buy.stripe.com/abc?locale=en&client_reference_id=TAVERN");
  });

  it("strips anything Stripe would refuse in a reference", () => {
    expect(honestyBoxHref("https://buy.stripe.com/abc", "TA VERN/")).toBe(
      "https://buy.stripe.com/abc?client_reference_id=TAVERN",
    );
  });
});

describe("dayPassSessionParams", () => {
  const params = dayPassSessionParams({
    priceId: "price_123",
    userId: "user-uuid",
    origin: "https://pub-golf.example.com",
  });

  it("is a one-off payment for exactly one green fee", () => {
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([{ price: "price_123", quantity: 1 }]);
  });

  it("carries the fulfilment contract in metadata, and no round", () => {
    // The webhook trusts nothing but this: what it reads back out of the
    // session is exactly what the entitlement row becomes. A day pass is
    // bought before any round exists, so there is no round to name.
    expect(params.metadata).toEqual({
      kind: "green_fee",
      user_id: "user-uuid",
    });
  });

  it("comes back to the table the host was setting, either way", () => {
    expect(params.success_url).toBe("https://pub-golf.example.com/new?fee=paid");
    expect(params.cancel_url).toBe("https://pub-golf.example.com/new");
  });
});

describe("the day pass window", () => {
  const paidAt = Date.parse("2026-08-09T19:30:00.000Z");

  it("runs 24 hours from the moment it was paid", () => {
    expect(dayPassExpiry(paidAt)).toBe("2026-08-10T19:30:00.000Z");
    expect(DAY_PASS_HOURS).toBe(24);
  });

  it("is live right up to its expiry and not a millisecond past", () => {
    const runsOut = dayPassExpiry(paidAt);
    expect(dayPassLive(runsOut, paidAt)).toBe(true);
    expect(dayPassLive(runsOut, Date.parse(runsOut) - 1)).toBe(true);
    expect(dayPassLive(runsOut, Date.parse(runsOut))).toBe(false);
    expect(dayPassLive(runsOut, Date.parse(runsOut) + 1)).toBe(false);
  });

  it("treats a null expiry as never running out — the column's contract", () => {
    expect(dayPassLive(null, paidAt)).toBe(true);
    expect(dayPassLive(undefined, paidAt)).toBe(true);
  });

  it("treats an unreadable expiry as run out, never as forever", () => {
    expect(dayPassLive("not a date", paidAt)).toBe(false);
  });
});

describe("GREEN_FEE_EXTRAS", () => {
  it("lists something real — the covenant's rule about this array", () => {
    // Money only ever buys what exists. The printed pack and the colours
    // join this list on the day they ship, and not before.
    expect(GREEN_FEE_EXTRAS.length).toBeGreaterThan(0);
    for (const extra of GREEN_FEE_EXTRAS) {
      expect(extra.title.trim()).not.toBe("");
      expect(extra.detail.trim()).not.toBe("");
    }
  });
});
