import { describe, expect, it } from "vitest";

import {
  billingEnabled,
  checkoutOrigin,
  DAY_PASS_HOURS,
  dayPassLive,
  dayPassSessionParams,
  GREEN_FEE_EXTRAS,
  honestyBoxHref,
  secondFeeRefusal,
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
  /** The stamp `activate_day_pass` writes at tee-off, as this side reads it.
   * Computed here rather than through a helper: there was one, it stopped
   * having a caller when the day moved to tee-off, and a second answer in
   * TypeScript to "when does a host's day end" is the thing to avoid. */
  const dayAfter = (fromMs: number) =>
    new Date(fromMs + DAY_PASS_HOURS * 3_600_000).toISOString();

  it("runs 24 hours from the moment the round tees off", () => {
    expect(dayAfter(paidAt)).toBe("2026-08-10T19:30:00.000Z");
    expect(DAY_PASS_HOURS).toBe(24);
  });

  it("is live right up to its expiry and not a millisecond past", () => {
    const runsOut = dayAfter(paidAt);
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

describe("why a second green fee is refused", () => {
  const running = new Date(Date.now() + 3_600_000).toISOString();

  it("lets a host with no fee through", () => {
    expect(
      secondFeeRefusal({ liveExpiresAt: undefined, canStillPlan: false }),
    ).toBeNull();
  });

  it("refuses while one is running, whatever its ledger says", () => {
    // The day pass is more than the caddy: a running fee covers the table for
    // the round itself, so a spent ledger does not make it finished.
    expect(
      secondFeeRefusal({ liveExpiresAt: running, canStillPlan: false }),
    ).toMatch(/runs all day/i);
    expect(
      secondFeeRefusal({ liveExpiresAt: running, canStillPlan: true }),
    ).toMatch(/runs all day/i);
  });

  it("refuses a dormant fee that can still do something, and says why", () => {
    // Different sentence on purpose. "Runs all day" is a lie about a fee whose
    // day has not started, and the host is about to wonder where their day
    // went.
    const refusal = secondFeeRefusal({
      liveExpiresAt: null,
      canStillPlan: true,
    });
    expect(refusal).toMatch(/tee off/i);
    expect(refusal).not.toMatch(/runs all day/i);
  });

  it("lets a dormant fee with nothing left through — the bug this exists for", () => {
    // Bought a fee, planned the courses, spent every credit, never teed off.
    // `expires_at` is still null because the day starts at tee-off, and a null
    // read as "live" told them the thing they had just used up was already
    // paid — with no way to buy another.
    expect(
      secondFeeRefusal({ liveExpiresAt: null, canStillPlan: false }),
    ).toBeNull();
  });

  it("never quotes a price in the refusal", () => {
    // A refusal is exactly where money is allowed to speak, but this one is
    // "you already have one" — there is nothing to sell, so there is nothing
    // to price. See `tests/unit/covenant-money.test.ts`.
    for (const liveExpiresAt of [undefined, null, running]) {
      for (const canStillPlan of [true, false]) {
        expect(secondFeeRefusal({ liveExpiresAt, canStillPlan }) ?? "").not.toMatch(
          /£|\$|\d+\.\d\d/,
        );
      }
    }
  });
});

/**
 * Where a paid checkout comes back to.
 *
 * This existed as a constant and was only ever right on production. Every
 * other deployment — preview, and every throwaway branch URL under it — sent
 * the buyer home to the live site after paying, on a different Supabase
 * project, with nothing to show for the money. The purchase worked and the
 * webhook fulfilled it; the buyer was just looking at the wrong app.
 */
describe("checkoutOrigin", () => {
  const FALLBACK = "https://pub-golf.glyn.dev";

  function headersOf(entries: Record<string, string>): Headers {
    return new Headers(entries);
  }

  it("comes back to the deployment the buyer is on", () => {
    expect(
      checkoutOrigin(
        headersOf({
          "x-forwarded-host": "pub-golf-preview.glyn.dev",
          "x-forwarded-proto": "https",
        }),
        FALLBACK,
      ),
    ).toBe("https://pub-golf-preview.glyn.dev");
  });

  it("handles a throwaway branch preview, which is the case that hurt", () => {
    // A per-branch Vercel URL cannot be known at build time, so no env var
    // could ever have covered this one.
    expect(
      checkoutOrigin(
        headersOf({
          "x-forwarded-host":
            "pub-golf-git-claude-course-builder-p-fbaf84-glynfincks-projects.vercel.app",
          "x-forwarded-proto": "https",
        }),
        FALLBACK,
      ),
    ).toBe(
      "https://pub-golf-git-claude-course-builder-p-fbaf84-glynfincks-projects.vercel.app",
    );
  });

  it("falls back to host when the forwarded one is absent", () => {
    expect(checkoutOrigin(headersOf({ host: "localhost:3105" }), FALLBACK)).toBe(
      "https://localhost:3105",
    );
  });

  it("keeps http when that is what the proxy says — local dev", () => {
    expect(
      checkoutOrigin(
        headersOf({ host: "localhost:3105", "x-forwarded-proto": "http" }),
        FALLBACK,
      ),
    ).toBe("http://localhost:3105");
  });

  it("takes the client's entry when proxies stack", () => {
    // Comma-joined headers are the shape a second proxy leaves behind, and
    // the leftmost entry is the one the browser asked for.
    expect(
      checkoutOrigin(
        headersOf({
          "x-forwarded-host": "pub-golf-preview.glyn.dev, internal.vercel",
          "x-forwarded-proto": "https, http",
        }),
        FALLBACK,
      ),
    ).toBe("https://pub-golf-preview.glyn.dev");
  });

  it("falls back when there is no request to read — the old behaviour", () => {
    expect(checkoutOrigin(headersOf({}), FALLBACK)).toBe(FALLBACK);
  });

  it("never returns a bare or trailing-slash origin", () => {
    // Both call sites append `/new?fee=paid` and `/courses/new` directly.
    for (const host of ["pub-golf-preview.glyn.dev", "localhost:3105"]) {
      const origin = checkoutOrigin(headersOf({ host }), FALLBACK);
      expect(origin).not.toMatch(/\/$/);
      expect(origin).toMatch(/^https?:\/\/.+/);
    }
  });
});
