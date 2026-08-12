import { randomUUID } from "node:crypto";

import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import {
  CADDY_TOPUP_LOOKUP_KEYS,
  CADDY_TOPUPS,
  dayPassSessionParams,
} from "@/lib/billing";
import { CADDY_GRANT_SIZE } from "@/lib/caddy/credits";
import { TARIFF } from "@/lib/tariff";

/**
 * The sandbox smoke tier: the one place tests talk to real Stripe. It
 * exists for the failures the offline webhook spec cannot see — a lookup
 * key missing from the account, a product without the tax code Managed
 * Payments demands (a rejection we met for real on the live account), a
 * session parameter today's API refuses. Network means flake risk, so
 * this tier lives in its own dispatch/weekly workflow and never in the
 * required PR gate.
 *
 * It runs against whatever STRIPE_SECRET_KEY holds — the same variable
 * local dev keeps a sandbox key in — and refuses anything that is not a
 * test-mode key: the live account is nobody's fixture.
 */

const key = process.env.STRIPE_SECRET_KEY;
if (key && !key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  throw new Error(
    "stripe sandbox smoke: refusing a non-test key — point STRIPE_SECRET_KEY at a sandbox.",
  );
}

describe.skipIf(!key)("stripe sandbox", () => {
  const stripe = new Stripe(key ?? "sk_test_unreachable");

  async function priceByLookup(lookupKey: string) {
    const { data } = await stripe.prices.list({
      lookup_keys: [lookupKey],
      expand: ["data.currency_options"],
      limit: 1,
    });
    const price = data[0];
    if (!price) {
      throw new Error(
        `no active price carries lookup key "${lookupKey}" — run scripts/stripe-seed.mjs against this sandbox first`,
      );
    }
    return price;
  }

  async function productOf(price: Stripe.Price) {
    const id =
      typeof price.product === "string" ? price.product : price.product.id;
    return stripe.products.retrieve(id);
  }

  it("the green fee reads back exactly as the tariff prints it", async () => {
    const price = await priceByLookup(TARIFF.greenFee.lookupKey);
    expect(price.currency).toBe("gbp");
    expect(price.unit_amount).toBe(TARIFF.greenFee.amounts.gbp);
    expect(price.tax_behavior).toBe("inclusive");

    for (const [currency, amount] of Object.entries(TARIFF.greenFee.amounts)) {
      const option = price.currency_options?.[currency];
      expect(option, `green fee is missing ${currency}`).toBeDefined();
      expect(option?.unit_amount).toBe(amount);
      expect(option?.tax_behavior).toBe("inclusive");
    }

    const product = await productOf(price);
    expect(product.active).toBe(true);
    // Managed Payments refuses products without an eligible tax code —
    // the exact rejection the live account handed us once already.
    expect(product.tax_code).toBe(TARIFF.greenFee.taxCode);
  });

  it("the honesty box takes what you feel, within the printed bounds", async () => {
    const price = await priceByLookup(TARIFF.honestyBox.lookupKey);
    expect(price.custom_unit_amount?.minimum).toBe(TARIFF.honestyBox.limits.gbp.min);
    expect(price.custom_unit_amount?.preset).toBe(TARIFF.honestyBox.limits.gbp.preset);

    for (const [currency, limits] of Object.entries(TARIFF.honestyBox.limits)) {
      const option = price.currency_options?.[currency];
      expect(option, `honesty box is missing ${currency}`).toBeDefined();
      expect(option?.custom_unit_amount?.minimum).toBe(limits.min);
      expect(option?.custom_unit_amount?.preset).toBe(limits.preset);
    }

    const product = await productOf(price);
    expect(product.tax_code).toBe(TARIFF.honestyBox.taxCode);
  });

  it("a real checkout session opens for the green fee, then is folded away", async () => {
    const price = await priceByLookup(TARIFF.greenFee.lookupKey);
    const session = await stripe.checkout.sessions.create(
      dayPassSessionParams({
        priceId: price.id,
        userId: randomUUID(),
        origin: "https://example.com",
      }),
    );
    try {
      expect(session.url).toBeTruthy();
      expect(session.mode).toBe("payment");
      expect(session.amount_total).toBe(TARIFF.greenFee.amounts.gbp);
      expect(session.currency).toBe("gbp");
      expect(session.metadata?.kind).toBe("green_fee");
    } finally {
      // Leave the sandbox as found: an expired session can never be paid.
      await stripe.checkout.sessions.expire(session.id);
    }
  });

  /**
   * The top-ups: two rungs of more caddy, and the pricing rule that binds them.
   *
   * The seam these cover is not "does Stripe have a price" — it is that four
   * numbers now have to agree across three places (lib/billing.ts,
   * lib/tariff.ts, the Stripe account, and caddy_topup_size in SQL), and the
   * only one of those a typecheck can see is the first two.
   */
  for (const sku of [
    TARIFF.caddyTopupOne,
    TARIFF.caddyTopupThree,
    TARIFF.caddyTopupCourse,
  ]) {
    it(`${sku.lookupKey} reads back exactly as the tariff prints it`, async () => {
      const price = await priceByLookup(sku.lookupKey);
      expect(price.unit_amount).toBe(sku.amounts.gbp);
      expect(price.currency).toBe("gbp");
      expect(price.tax_behavior).toBe("inclusive");

      for (const [currency, amount] of Object.entries(sku.amounts)) {
        if (currency === "gbp") continue;
        const option = price.currency_options?.[currency];
        expect(option, `${sku.lookupKey} carries no ${currency} price`).toBeTruthy();
        expect(option?.unit_amount).toBe(amount);
      }

      // Managed Payments rejects a product without one, which is a rejection
      // this repo met for real on the live account rather than in a doc.
      const product = await productOf(price);
      expect(product.tax_code).toBe(sku.taxCode);

      // The kind travels on the price as well as the product, because the
      // webhook reads it off the line item to know what to grant.
      expect(price.metadata?.kind).toBe(sku.lookupKey);
    });
  }

  it("every top-up the code knows how to grant is actually on sale", async () => {
    // The failure this catches: a rung added to CADDY_TOPUPS and to the SQL,
    // shipped, and never seeded — so the grant logic is perfect and the button
    // 404s. Driven from the code's list, never from a list written here.
    for (const lookupKey of CADDY_TOPUP_LOOKUP_KEYS) {
      const price = await priceByLookup(lookupKey);
      expect(price.active).toBe(true);
      expect(CADDY_TOPUPS[lookupKey].redesign).toBeGreaterThan(0);
    }
  });

  it("no top-up sells a round cheaper than the green fee does", async () => {
    // The load-bearing one, and the reason it lives against real Stripe rather
    // than against the constants: the rule is about what a host can actually
    // buy. The bundle has to be the best rate anyone can get, or it is the
    // option to avoid — see docs/CADDY-TOPUPS.md.
    const fee = await priceByLookup(TARIFF.greenFee.lookupKey);
    const feePerRound = (fee.unit_amount ?? 0) / CADDY_GRANT_SIZE.redesign;
    expect(feePerRound).toBeGreaterThan(0);

    for (const lookupKey of CADDY_TOPUP_LOOKUP_KEYS) {
      const price = await priceByLookup(lookupKey);
      const perRound = (price.unit_amount ?? 0) / CADDY_TOPUPS[lookupKey].redesign;
      expect(
        perRound,
        `${lookupKey} sells a round at ${perRound}p, under the fee's ${feePerRound}p`,
      ).toBeGreaterThanOrEqual(feePerRound);
    }
  });

  it("a top-up checkout totals what the board says", async () => {
    const price = await priceByLookup(TARIFF.caddyTopupOne.lookupKey);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: "https://pub-golf.glyn.dev/tariff?paid=1",
      cancel_url: "https://pub-golf.glyn.dev/tariff",
      client_reference_id: randomUUID(),
      metadata: { kind: TARIFF.caddyTopupOne.lookupKey },
    });
    expect(session.amount_total).toBe(TARIFF.caddyTopupOne.amounts.gbp);
    expect(session.metadata?.kind).toBe(TARIFF.caddyTopupOne.lookupKey);
  });

});
