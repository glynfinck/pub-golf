import { CADDY_TOPUP_LOOKUP_KEYS, GREEN_FEE_LOOKUP_KEY } from "@/lib/billing";

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
  /**
   * More caddy, and the only thing on this board that does not expire.
   *
   * Priced well clear of the fee's own rate rather than just above it. A green
   * fee is £12 for five whole cards — £2.40 each — and these are £5.00, £4.50
   * and £4.00, so the bundle is obviously the better deal and a top-up reads
   * as the convenience it is. A floor that only just clears the fee makes the
   * fee look like a rounding error. Both properties have a unit test.
   *
   * £12 for the three-pack is the same sticker as a whole green fee, and that
   * is the point: at one price a host sees three rounds they keep for ever
   * against five that go with the day. The comparison does the selling.
   */
  caddyTopupOne: {
    lookupKey: CADDY_TOPUP_LOOKUP_KEYS[0],
    productName: "Another round",
    taxCode: "txcd_10103000",
    amounts: { gbp: 500, usd: 600, eur: 600, cad: 900, aud: 1000 },
  },
  caddyTopupThree: {
    lookupKey: CADDY_TOPUP_LOOKUP_KEYS[1],
    productName: "A few more rounds",
    taxCode: "txcd_10103000",
    amounts: { gbp: 1200, usd: 1500, eur: 1500, cad: 2100, aud: 2400 },
  },
  /**
   * Another course, kept — the rung that buys a second saved card rather than
   * another attempt at the first.
   *
   * £9 for two whole cards is £4.50 each. That number is chosen to keep the
   * ladder *monotone*: £5.00 a card at one, £4.50 at two, £4.00 at three. At
   * £8 the rung tied with the three-pack at £4.00 and threw in a kept-course
   * slot, so the dearer rung was the worse buy — "cheaper with volume" was
   * untrue in the middle of its own ladder.
   *
   * The fee stays the best rate anyone can get at £2.40 a card, which is the
   * standing rule in docs/CADDY-TOPUPS.md, and is still the only purchase that
   * also covers the round itself. There is a unit test on both properties.
   */
  caddyTopupCourse: {
    lookupKey: CADDY_TOPUP_LOOKUP_KEYS[2],
    productName: "Another course",
    taxCode: "txcd_10103000",
    amounts: { gbp: 900, usd: 1100, eur: 1100, cad: 1600, aud: 1800 },
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
