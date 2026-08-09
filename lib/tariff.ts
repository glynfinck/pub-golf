import { GREEN_FEE_LOOKUP_KEY } from "@/lib/billing";

/**
 * The tariff, as data: what each price object holds in Stripe, in every
 * currency. One source of truth for the sandbox smoke test's expectations
 * (tests/sandbox) — and the reference the seeder (scripts/stripe-seed.mjs,
 * which cannot import TS) is kept in step with; the smoke test is what
 * catches the two drifting apart. Amounts are smallest units and
 * tax-inclusive; gbp is each price's base currency.
 */
export const TARIFF = {
  greenFee: {
    lookupKey: GREEN_FEE_LOOKUP_KEY,
    productName: "The green fee",
    taxCode: "txcd_10103000",
    amounts: { gbp: 400, usd: 500, eur: 500, cad: 700, aud: 800 },
  },
  honestyBox: {
    lookupKey: "honesty_box",
    productName: "The honesty box",
    taxCode: "txcd_10103000",
    limits: {
      gbp: { min: 300, preset: 500 },
      usd: { min: 400, preset: 700 },
      eur: { min: 400, preset: 600 },
      cad: { min: 500, preset: 900 },
      aud: { min: 600, preset: 1000 },
    },
  },
} as const;
