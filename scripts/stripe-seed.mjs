import Stripe from "stripe";

/**
 * Mirror the tariff into a Stripe sandbox: both products, multi-currency
 * prices under the canonical lookup keys, tax codes for Managed Payments.
 * Idempotent — an existing lookup key is left alone (bar a missing tax
 * code, which is patched), so the weekly workflow can run it blind.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-seed.mjs
 *
 * The amounts here are kept in step with lib/tariff.ts (this file cannot
 * import TS); the sandbox smoke test cross-checks the seeded account
 * against that module, so drift between the two turns a run red rather
 * than lingering.
 */

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.log("stripe-seed: no STRIPE_SECRET_KEY set — nothing to do.");
  process.exit(0);
}
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error(
    "stripe-seed: refusing a non-test key. The live account was set up by " +
      "hand and is not this script's to touch.",
  );
  process.exit(1);
}

const stripe = new Stripe(key);
const TAX_CODE = "txcd_10103000"; // SaaS, personal use — Managed Payments needs one

const PRICES = [
  {
    lookup_key: "green_fee",
    nickname: "Green fee — one round, the whole table",
    product: { name: "The green fee", metadata: { kind: "green_fee" } },
    metadata: { kind: "green_fee" },
    currency: "gbp",
    unit_amount: 400,
    currency_options: {
      usd: { unit_amount: 500, tax_behavior: "inclusive" },
      eur: { unit_amount: 500, tax_behavior: "inclusive" },
      cad: { unit_amount: 700, tax_behavior: "inclusive" },
      aud: { unit_amount: 800, tax_behavior: "inclusive" },
    },
  },
  {
    lookup_key: "honesty_box",
    nickname: "Honesty box — pay what you feel",
    product: { name: "The honesty box", metadata: { kind: "tip" } },
    metadata: { kind: "tip" },
    currency: "gbp",
    custom_unit_amount: { enabled: true, minimum: 300, preset: 500 },
    currency_options: {
      usd: {
        custom_unit_amount: { enabled: true, minimum: 400, preset: 700 },
        tax_behavior: "inclusive",
      },
      eur: {
        custom_unit_amount: { enabled: true, minimum: 400, preset: 600 },
        tax_behavior: "inclusive",
      },
      cad: {
        custom_unit_amount: { enabled: true, minimum: 500, preset: 900 },
        tax_behavior: "inclusive",
      },
      aud: {
        custom_unit_amount: { enabled: true, minimum: 600, preset: 1000 },
        tax_behavior: "inclusive",
      },
    },
  },
];

for (const spec of PRICES) {
  const { data } = await stripe.prices.list({
    lookup_keys: [spec.lookup_key],
    limit: 1,
  });
  const existing = data[0];

  if (existing) {
    const productId =
      typeof existing.product === "string"
        ? existing.product
        : existing.product.id;
    const product = await stripe.products.retrieve(productId);
    if (!product.tax_code) {
      await stripe.products.update(productId, { tax_code: TAX_CODE });
      console.log(`stripe-seed: ${spec.lookup_key} — patched missing tax code.`);
    } else {
      console.log(`stripe-seed: ${spec.lookup_key} — already seeded.`);
    }
    continue;
  }

  const { product, ...priceSpec } = spec;
  const price = await stripe.prices.create({
    ...priceSpec,
    tax_behavior: "inclusive",
    product_data: { ...product, tax_code: TAX_CODE },
  });
  console.log(`stripe-seed: ${spec.lookup_key} — created ${price.id}.`);
}

console.log("stripe-seed: the sandbox tariff matches the board.");
