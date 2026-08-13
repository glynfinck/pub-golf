import { describe, expect, it } from "vitest";

import {
  CADDY_TOPUP_LOOKUP_KEYS,
  CADDY_TOPUPS,
  CADDY_TOPUPS_ON_SALE,
} from "@/lib/billing";
import {
  CADDY_COURSES_PER_FEE,
  CADDY_GRANT_SIZE,
  CADDY_QUOTAS,
  CADDY_TOPUP_OFFERS,
  coursesLeftNote,
} from "@/lib/caddy/credits";
import { sticker, TARIFF } from "@/lib/tariff";

describe("the top-up offers and the tariff agree", () => {
  it("offers exactly the rungs that are on sale", () => {
    // The seam that broke repeatedly while this was built: a rung existing in
    // one list and not another. A top-up has to exist in four places — the
    // lookup keys, the grant sizes, the tariff, and the button — and this
    // holds three of them together. The fourth is Postgres, which the db tier
    // checks against `caddy_topup_size`.
    expect(CADDY_TOPUP_OFFERS.map((offer) => offer.lookupKey)).toEqual([
      ...CADDY_TOPUPS_ON_SALE,
    ]);
    for (const offer of CADDY_TOPUP_OFFERS) {
      expect(CADDY_TOPUPS[offer.lookupKey].redesign).toBeGreaterThan(0);
      expect(CADDY_TOPUPS[offer.lookupKey].tweak).toBeGreaterThan(0);
    }
  });

  it("only ever sells a rung the ledger knows how to grant", () => {
    // The direction that matters. The shelf may be a subset of what the ledger
    // honours — that is what retiring a rung means — but never a superset: a
    // key on sale with no entry in `CADDY_TOPUPS` and no arm in
    // `caddy_topup_size()` is a purchase that takes money and grants nothing,
    // which is the exact bug `caddy_topup_course` shipped with once already.
    for (const lookupKey of CADDY_TOPUPS_ON_SALE) {
      expect(CADDY_TOPUP_LOOKUP_KEYS).toContain(lookupKey);
    }
  });

  it("keeps honouring the rung it retired", () => {
    // A purchase is a promise. `caddy_topup_course` came off the shelf because
    // it sold a different *kind* of thing from the other two — a course to
    // keep rather than another go at the one in the book — on a row of three
    // buttons that consequently could not be read straight down. None of that
    // is a reason to strand somebody who bought one: the key stays in the
    // honoured list, the grant sizes stay frozen, `caddy_topup_size()` still
    // answers for it, and the webhook still fulfils an in-flight checkout.
    expect(CADDY_TOPUP_LOOKUP_KEYS).toContain("caddy_topup_course");
    expect(CADDY_TOPUPS.caddy_topup_course.course).toBe(1);
    expect(CADDY_TOPUPS.caddy_topup_course.redesign).toBeGreaterThan(0);
    expect(CADDY_TOPUPS_ON_SALE).not.toContain("caddy_topup_course");
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

  it("never sells a go cheaper than the green fee does", () => {
    // The pricing rule, held where a typo would otherwise land it on a live
    // button. The bundle has to be the best rate anyone can get, or it is the
    // option to avoid.
    //
    // Divided by `CADDY_COURSES_PER_FEE` rather than by the four re-designs.
    // This test and "keeps the green fee the best rate on the board" below
    // disagreed about what a fee's per-card rate is — £12/4 = £3 here against
    // £12/5 = £2.40 there — so the two guards on one rule were checking two
    // different rules. Five is the honest figure: it is what a fee actually
    // produces, and the number every surface quotes.
    const feePerGo = TARIFF.greenFee.amounts.gbp / CADDY_COURSES_PER_FEE;
    const rates = [
      TARIFF.caddyTopupOne.amounts.gbp / CADDY_TOPUPS.caddy_topup_1.redesign,
      TARIFF.caddyTopupThree.amounts.gbp / CADDY_TOPUPS.caddy_topup_3.redesign,
    ];
    for (const rate of rates) expect(rate).toBeGreaterThanOrEqual(feePerGo);
  });

  it("describes what is bought, and never how much is left", () => {
    // The covenant's line about no countdown clocks, held at the point of
    // sale: these say "one more go" because that is what a host is buying, not
    // because something is running out.
    for (const offer of CADDY_TOPUP_OFFERS) {
      expect(offer.goes).toMatch(/\bgoe?s?\b/);
      expect(offer.goes).not.toMatch(/left|remaining|only/i);
    }
  });

  it("never calls a caddy credit a round", () => {
    // The rename, held so it cannot drift back. `round` is this app's most
    // spoken-for noun — a night of pub golf, a table, a join code — and
    // `app/league/page.tsx` renders "3 rounds" meaning three nights played
    // while this shelf rendered "3 rounds" meaning three attempts at one
    // course. The two are eight taps apart.
    //
    // Worst on `/tariff`, where "More caddy — 3 rounds · £12" sat one line
    // under the £12 green fee: the word made the cheaper-per-card product look
    // like the dearer one, which is the opposite of what the ladder is priced
    // to do.
    for (const offer of CADDY_TOPUP_OFFERS) {
      expect(offer.goes).not.toMatch(/round/i);
    }
    // And on the receipt, which has to stand alone with no caddy near it.
    // "Another round · £5.00" on a card statement from a pub golf app named
    // the one thing the buyer had not bought.
    for (const sku of [TARIFF.caddyTopupOne, TARIFF.caddyTopupThree]) {
      expect(sku.productName).not.toMatch(/round/i);
      expect(sku.productName).toMatch(/caddy/i);
    }
  });
});

describe("the button counts what the purchase grants", () => {
  it("reads its count off CADDY_TOPUPS rather than a literal", () => {
    // Both numbers were hand-written when this shipped, which is the shape of
    // every copy bug on this branch: a number in two places is right until one
    // of them moves. Changing the grant must move the label with it.
    for (const offer of CADDY_TOPUP_OFFERS) {
      const grant = CADDY_TOPUPS[offer.lookupKey];
      // Both rungs of the card ladder, because `guard_caddy_spend` spends them
      // in order and a host cannot tell which one paid for the card in front
      // of them.
      const cards = (grant.course ?? 0) + grant.redesign;
      // One is spelled out, anything above it is a digit — the wording
      // `coursesLeftNote` already uses on the badge directly above this shelf.
      expect(offer.goes).toContain(cards === 1 ? "one" : String(cards));
    }
  });

  it("says go, not goes, for a single one", () => {
    const single = CADDY_TOPUP_OFFERS.find(
      (offer) => CADDY_TOPUPS[offer.lookupKey].redesign === 1,
    );
    expect(single?.goes).toBe("one more go");
  });

  it("words a go the way the badge above it words one", () => {
    // The bug this rename fixed was not only the word `round` — it was that
    // the shop and the badge six inches above it used two different nouns for
    // one quantity. `CaddyUsage` reads "3 more goes at it" off
    // `coursesLeftNote`; the button reads "3 more goes". Same noun, same
    // spelling rule, one concept.
    const three = CADDY_TOPUP_OFFERS.find(
      (offer) => CADDY_TOPUPS[offer.lookupKey].redesign === 3,
    );
    expect(three?.goes).toBe("3 more goes");
    expect(coursesLeftNote(3)).toContain("3 more goes");
    expect(coursesLeftNote(1).toLowerCase()).toContain("one more go");
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

  it("puts nothing on the shelf that buys a course to keep", () => {
    // The shelf sells one kind of thing now: more goes at the course in the
    // book. That is what lets two buttons be read straight down against their
    // prices — the row was three, ran £5, £12, £9, and the odd one out bought
    // a second course to *keep*, a difference neither the price nor the count
    // could show. A course credit wandering onto a rung that is still on sale
    // would put that unreadable choice back without the price moving.
    for (const lookupKey of CADDY_TOPUPS_ON_SALE) {
      expect(CADDY_TOPUPS[lookupKey].course ?? 0, lookupKey).toBe(0);
    }
  });

  it("gives a course rung a revision to go with it", () => {
    // Load-bearing rather than generous, and checked across every rung the
    // ledger honours rather than only those on sale — `caddy_topup_course` is
    // retired but still redeemable, so the rule has to keep holding for it.
    // `liveFee` resolves which purchase a session works under by walking the
    // same ladder the spend does, so a rung granting a course and nothing else
    // would leave a host one card in with no way to revise it.
    for (const lookupKey of CADDY_TOPUP_LOOKUP_KEYS) {
      if ((CADDY_TOPUPS[lookupKey].course ?? 0) === 0) continue;
      expect(CADDY_TOPUPS[lookupKey].redesign, lookupKey).toBeGreaterThan(0);
    }
  });

  it("keeps the green fee the best rate on the board", () => {
    // The standing rule: the bundle has to be the best rate
    // anyone can get, or it is the option to avoid. Checked per whole card,
    // which is the unit a host is really buying.
    const feeCards = CADDY_GRANT_SIZE.course + CADDY_GRANT_SIZE.redesign;
    const feePerCard = TARIFF.greenFee.amounts.gbp / feeCards;
    for (const sku of [
      TARIFF.caddyTopupOne,
      TARIFF.caddyTopupThree,
      TARIFF.caddyTopupCourse,
    ]) {
      const grant = CADDY_TOPUPS[sku.lookupKey];
      const cards = (grant.course ?? 0) + grant.redesign;
      expect(
        sku.amounts.gbp / cards,
        `${sku.lookupKey} undercuts the fee`,
      ).toBeGreaterThan(feePerCard);
    }
  });

  it("gives the fee more tweaks per card than any top-up", () => {
    // Across every rung the ledger honours, not only those on sale: a retired
    // rung is still redeemable, so it still has to be the worse rate.
    const feeTweaks = CADDY_GRANT_SIZE.tweak / CADDY_COURSES_PER_FEE;
    for (const lookupKey of CADDY_TOPUP_LOOKUP_KEYS) {
      const grant = CADDY_TOPUPS[lookupKey];
      const cards = (grant.course ?? 0) + grant.redesign;
      expect(
        grant.tweak / cards,
        `${lookupKey} is more generous than the fee`,
      ).toBeLessThanOrEqual(feeTweaks);
    }
  });
});
