import { describe, expect, it } from "vitest";

import { CADDY_TOPUP_LOOKUP_KEYS, CADDY_TOPUPS } from "@/lib/billing";
import { CADDY_TOPUP_OFFERS } from "@/lib/caddy/credits";
import { sticker, TARIFF } from "@/lib/tariff";

describe("the top-up offers and the tariff agree", () => {
  it("offers exactly the rungs the code knows how to grant", () => {
    // The seam that broke repeatedly while this was built: a rung existing in
    // one list and not another. A top-up has to exist in four places — the
    // lookup keys, the grant sizes, the tariff, and the button — and this
    // holds three of them together. The fourth is Postgres, which the db tier
    // checks against `caddy_topup_size`.
    expect(CADDY_TOPUP_OFFERS.map((offer) => offer.lookupKey)).toEqual([
      ...CADDY_TOPUP_LOOKUP_KEYS,
    ]);
    for (const offer of CADDY_TOPUP_OFFERS) {
      expect(CADDY_TOPUPS[offer.lookupKey].redesign).toBeGreaterThan(0);
      expect(CADDY_TOPUPS[offer.lookupKey].tweak).toBeGreaterThan(0);
    }
  });

  it("prints the price the board actually charges", () => {
    // Derived rather than written, so a repriced SKU cannot leave a stale
    // number on a button — which is exactly how the refusal ended up saying
    // "the caddy plans one to a fee" after a fee started planning four.
    expect(CADDY_TOPUP_OFFERS[0].price).toBe(
      sticker(TARIFF.caddyTopupOne.amounts.gbp),
    );
    expect(CADDY_TOPUP_OFFERS[1].price).toBe(
      sticker(TARIFF.caddyTopupThree.amounts.gbp),
    );
  });

  it("never sells a round cheaper than the green fee does", () => {
    // The pricing rule, held where a typo would otherwise land it on a live
    // button. The bundle has to be the best rate anyone can get, or it is the
    // option to avoid — see docs/CADDY-TOPUPS.md.
    const feePerRound = TARIFF.greenFee.amounts.gbp / 4;
    const rates = [
      TARIFF.caddyTopupOne.amounts.gbp / CADDY_TOPUPS.caddy_topup_1.redesign,
      TARIFF.caddyTopupThree.amounts.gbp / CADDY_TOPUPS.caddy_topup_3.redesign,
    ];
    for (const rate of rates) expect(rate).toBeGreaterThanOrEqual(feePerRound);
  });

  it("describes what is bought, and never how much is left", () => {
    // The covenant's line about no countdown clocks, held at the point of
    // sale: these say "1 round" because that is what a host is buying, not
    // because something is running out.
    for (const offer of CADDY_TOPUP_OFFERS) {
      expect(offer.rounds).toMatch(/round/);
      expect(offer.rounds).not.toMatch(/left|remaining|only/i);
    }
  });
});
