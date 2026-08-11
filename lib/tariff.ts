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
    // Tripled from the launch price when the caddy shipped: the fee stopped
    // being a day of small extras and became a night planned for you. The
    // ladder is the launch one scaled by exactly 3, which keeps whatever
    // reasoning set the original spreads and lands every currency on a round
    // number — a bar board has no 14.99 on it.
    amounts: { gbp: 1200, usd: 1500, eur: 1500, cad: 2100, aud: 2400 },
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

/**
 * A sticker, from smallest units. Round numbers print round — "£4", never
 * "£4.00", because the covenant's one honest tariff is written the way a
 * bar board is.
 */
export function sticker(pence: number): string {
  return pence % 100 === 0
    ? `£${pence / 100}`
    : `£${(pence / 100).toFixed(2)}`;
}

/**
 * What the copy quotes. Not what everyone pays: the price object carries
 * every currency, so Checkout presents the buyer their own — this is the
 * house's own board, and the surfaces that show it say so.
 */
export const GREEN_FEE_PRICE = sticker(TARIFF.greenFee.amounts.gbp);
