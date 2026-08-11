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
    // Kept in step with TARIFF.greenFee.amounts in lib/tariff.ts by hand —
    // this script cannot import TS. tests/sandbox is what catches them
    // drifting apart, and it asserts every currency, not just the base one.
    unit_amount: 1200,
    currency_options: {
      usd: { unit_amount: 1500, tax_behavior: "inclusive" },
      eur: { unit_amount: 1500, tax_behavior: "inclusive" },
      cad: { unit_amount: 2100, tax_behavior: "inclusive" },
      aud: { unit_amount: 2400, tax_behavior: "inclusive" },
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

const productOf = (price) =>
  typeof price.product === "string" ? price.product : price.product.id;

/**
 * Does the price on the account still say what the board says?
 *
 * This script used to answer "is there one?" and stop there, which was fine
 * while the tariff had never moved. The first time it did, the seeder said
 * "already seeded" and left the old amount standing — the board and the till
 * disagreeing, silently, on the one number a host is asked to trust.
 *
 * Every currency, not just the base one: a fee that moved in sterling and not
 * in euros is the kind of thing nobody notices until somebody in Dublin pays
 * last year's price. The two specs are different shapes — the green fee is a
 * fixed amount, the honesty box a range — so each is compared on whichever it
 * carries rather than on a union of both.
 */
function onBoard(price, spec) {
  const same = (option, want) =>
    want.unit_amount !== undefined
      ? option?.unit_amount === want.unit_amount
      : option?.custom_unit_amount?.minimum === want.custom_unit_amount.minimum &&
        option?.custom_unit_amount?.preset === want.custom_unit_amount.preset;

  return (
    same(price, spec) &&
    Object.entries(spec.currency_options).every(([currency, want]) =>
      same(price.currency_options?.[currency], want),
    )
  );
}

for (const spec of PRICES) {
  const { data } = await stripe.prices.list({
    lookup_keys: [spec.lookup_key],
    limit: 1,
    // Stripe omits currency_options unless asked for them, and a comparison
    // that cannot see them would call a half-moved tariff current.
    expand: ["data.currency_options"],
  });
  const existing = data[0];

  if (existing && onBoard(existing, spec)) {
    const product = await stripe.products.retrieve(productOf(existing));
    if (!product.tax_code) {
      await stripe.products.update(product.id, { tax_code: TAX_CODE });
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
    // A Price's amount is immutable, so moving the board means minting a new
    // one and walking the lookup key across. `transfer_lookup_key` does both
    // in one call, which matters: the app resolves `green_fee` at checkout, so
    // any window where the key belongs to nothing is a window where nobody can
    // pay. The product is reused rather than recreated — it is the same thing
    // being sold, and a second product would split the reporting for no gain.
    ...(existing
      ? { product: productOf(existing), transfer_lookup_key: true }
      : { product_data: { ...product, tax_code: TAX_CODE } }),
  });

  if (!existing) {
    console.log(`stripe-seed: ${spec.lookup_key} — created ${price.id}.`);
    continue;
  }

  // The old price is its product's `default_price` until something says
  // otherwise, and Stripe refuses to archive a default. Move the pointer
  // first, or the reprice half-lands: new price live, old one still on the
  // board beside it.
  await stripe.products.update(productOf(existing), { default_price: price.id });

  // Archived, never deleted. Sessions already paid still point at it, and a
  // receipt resolving to nothing is worse than one quoting the old price.
  await stripe.prices.update(existing.id, { active: false });
  console.log(
    `stripe-seed: ${spec.lookup_key} — repriced ${existing.id} → ${price.id}.`,
  );
}

console.log("stripe-seed: the sandbox tariff matches the board.");
