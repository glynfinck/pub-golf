import { describe, expect, it } from "vitest";

import { CADDY_TOPUP_LOOKUP_KEYS, CADDY_TOPUPS } from "@/lib/billing";
import {
  CADDY_COURSES_PER_FEE,
  CADDY_GRANT_SIZE,
  CADDY_QUOTAS,
  CADDY_TOPUP_OFFERS,
} from "@/lib/caddy/credits";
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

describe("the button counts what the purchase grants", () => {
  it("reads its round count off CADDY_TOPUPS rather than a literal", () => {
    // Both numbers were hand-written when this shipped, which is the shape of
    // every copy bug on this branch: a number in two places is right until one
    // of them moves. Changing the grant must move the label with it.
    for (const offer of CADDY_TOPUP_OFFERS) {
      const granted = CADDY_TOPUPS[offer.lookupKey].redesign;
      expect(offer.rounds).toContain(String(granted));
    }
  });

  it("says round, not rounds, for a single one", () => {
    const single = CADDY_TOPUP_OFFERS.find(
      (offer) => CADDY_TOPUPS[offer.lookupKey].redesign === 1,
    );
    expect(single?.rounds).toBe("1 round");
  });
});

/**
 * The shape of what a fee sells, held together on the TypeScript side.
 *
 * The db tier proves these equal `caddy_grant_size()`; this proves they are
 * *coherent* — that the numbers make the product the tariff describes. Both
 * matter, and only one of them needs a database.
 */
describe("the quotas a fee is made of", () => {
  it("names every quota the grant table sizes", () => {
    // `Record<CaddyQuota, number>` makes this a compile error rather than a
    // failure, which is the point — but a quota added to the enum and given a
    // size of zero would compile and read as "granted nothing".
    for (const quota of CADDY_QUOTAS) {
      expect(CADDY_GRANT_SIZE[quota], quota).toBeGreaterThan(0);
      expect(Number.isInteger(CADDY_GRANT_SIZE[quota]), quota).toBe(true);
    }
  });

  it("sells one course and four revisions of it", () => {
    expect(CADDY_GRANT_SIZE.course).toBe(1);
    expect(CADDY_COURSES_PER_FEE).toBe(5);
  });

  it("never lets a top-up buy a second saved course", () => {
    // The invariant seen from the top-up ladder, and the reason it is worth
    // stating: a fee files one course (`caddy_sessions_one_course_per_fee`),
    // and a top-up grants re-designs and tweaks — never a course credit. So
    // "another round" is another go at the card in hand, not a second card to
    // keep. A course credit appearing in `CADDY_TOPUPS` would quietly make the
    // rule per-purchase instead of per-fee.
    for (const offer of CADDY_TOPUP_OFFERS) {
      expect(
        Object.keys(CADDY_TOPUPS[offer.lookupKey]),
        `${offer.lookupKey} grants`,
      ).not.toContain("course");
    }
  });
});
