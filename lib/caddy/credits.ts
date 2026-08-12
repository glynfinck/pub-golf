import { CADDY_TOPUPS } from "@/lib/billing";
import { sticker, TARIFF } from "@/lib/tariff";

/**
 * What a green fee buys, counted.
 *
 * A fee is a fixed number of courses. Consumption is a fact rather than a
 * state: the credit is spent when a plan produces a card, and tearing that
 * course out of the book does not give it back — the caddy already did the
 * work and we already paid for it. That is the difference between this and the
 * holdings rule it replaced, where deleting the course erased the only
 * evidence the allowance had ever been used.
 *
 * Three things it deliberately does not charge for, all of them the same
 * promise the `failed` column keeps for money:
 *
 *   A refusal, a thin patch, a model error or a host who closes the tab
 *   mid-plan. No card, no credit.
 *
 *   Rolls and tweaks. They belong to a session that has already paid, and what
 *   bounds them is the budget and fair use, both of which count tokens. Worry
 *   one course all evening; starting a *new* one is what costs.
 *
 *   A course the host then edits by hand, for ever, free. The fee bought the
 *   planning, not the ownership.
 *
 * Hand-kept mirror of `public.caddy_courses_per_fee()`, proved equal by a db
 * test — a number the screen misquotes is a host told they have something they
 * do not.
 */
export const CADDY_QUOTAS = ["course", "redesign", "tweak"] as const;
export type CaddyQuota = (typeof CADDY_QUOTAS)[number];

/**
 * What one green fee grants of each quota. Mirrored from
 * `public.caddy_grant_size()` and proved equal by a db test.
 *
 * Re-designs are the countable thing a host buys and the only number that
 * helps at the point of sale. Tweaks are set where a real evening never
 * reaches them: the allowance exists so a runaway script meets something, not
 * so a fussy host does — which is why one is shown and the other is not.
 */
export const CADDY_GRANT_SIZE: Record<CaddyQuota, number> = {
  // The course itself: one, and the whole point of the quota existing. A fee
  // buys an evening's legwork and the host keeps the evening — not four of
  // them. `caddy_sessions_one_course_per_fee` is what actually holds the line;
  // this is what pays for the first card.
  course: 1,
  // Four revisions of that course, so the fee is a discount rather than merely
  // a bundle: £12 over five goes is £2.40 a go, where the smallest top-up is
  // £5 for one. See docs/CADDY-TOPUPS.md — the bundle has to be the best rate
  // anyone can get, or it is the option to avoid.
  redesign: 4,
  tweak: 60,
};

/**
 * How many whole cards a fee can produce: the course, plus every revision.
 *
 * Both rungs, because the ladder in `guard_caddy_spend` spends them in order
 * and a host cannot tell which one paid for the card in front of them. Naming
 * only the revisions would quote them a number one short of what they bought.
 */
export const CADDY_COURSES_PER_FEE =
  CADDY_GRANT_SIZE.course + CADDY_GRANT_SIZE.redesign;

/**
 * The line for a host who has spent every course on the fee they hold.
 *
 * No number in it, and no upsell. The number is on the screen already where it
 * is useful — before you spend one — and repeating it inside a refusal is how
 * a tariff turns into a scolding.
 */
export const CADDY_CREDITS_SPENT =
  "This green fee has planned all its courses. Every one of them is yours to keep and change, and plotting one by hand is free as always.";

/** How the remaining courses read on screen. Plain, and never a bare digit —
 * "2" beside a button is a badge nobody can parse. */
export function coursesLeftNote(left: number): string {
  if (left <= 0) return "No courses left on this fee";
  return left === 1 ? "One course left on this fee" : `${left} courses left on this fee`;
}

/**
 * What a host should know before tearing out a course the caddy planned.
 *
 * A fee files one course (`caddy_sessions_one_course_per_fee`), and tearing it
 * out is what frees the fee to file another — so this button is the one place
 * where "how many goes are left" stops being trivia and becomes the difference
 * between a decision and a loss. A host with no goes left who bins their course
 * has nothing to rebuild it with, and finding that out afterwards is the worst
 * possible order to learn it in.
 *
 * **This is the one place a tweak count appears**, and the exception is
 * deliberate. `lib/caddy/fair-use.ts` argues that a permanent meter on "ask as
 * often as you like" turns membership back into credits, and that still holds:
 * this is not a meter, it is an answer to a question the host is asking by
 * reaching for a destructive button. Naming it anywhere else would be the
 * mistake that argument is about.
 *
 * No pressure and no sales clock, per the covenant. It says what is true and
 * stops; the door to more is where it has always been, on the spent sheet.
 *
 * Null for a hand-plotted course, which has nothing to do with any of this.
 */
export function tearOutWarning(input: {
  /** Whether the caddy planned this one. A course somebody typed out by hand
   * costs nothing to rebuild and gets no warning. */
  caddyPlanned: boolean;
  /** Whole cards left on the fee — the course credit and the revisions
   * together, which is what `caddyAllowance` reports. */
  cardsLeft: number;
  tweaksLeft: number;
}): string | null {
  if (!input.caddyPlanned) return null;
  if (input.cardsLeft > 0) {
    const goes =
      input.cardsLeft === 1
        ? "one more go at it"
        : `${input.cardsLeft} more goes at it`;
    return `Tearing this out frees your fee to plan another — you have ${goes}.`;
  }
  if (input.tweaksLeft > 0) {
    return "This fee has no more courses in it, so the caddy can't plan you a replacement. Changing this one is still free, and there are tweaks left on it.";
  }
  return "This fee has no more courses and no tweaks left. Tear this out and the caddy can't rebuild it — though the drafting table is free, as always.";
}

/**
 * What the spent sheet offers, and the only place more caddy is named.
 *
 * Two rungs and no third: demand is lopsided — most hosts need none, some need
 * one — and a third turns one honest tariff into a pricing page. Prices are
 * derived from `TARIFF` rather than written here, so the board and the button
 * cannot disagree; `docs/CADDY-TOPUPS.md` carries the arithmetic behind them
 * and the rule that neither may sell a round below what the fee implies.
 *
 * The rounds are described, never counted down. A host reads "3 rounds"
 * because that is what they are buying, not because anything is running out.
 */
export const CADDY_TOPUP_OFFERS = [
  TARIFF.caddyTopupOne,
  TARIFF.caddyTopupThree,
].map((sku) => {
  const rounds = CADDY_TOPUPS[sku.lookupKey].redesign;
  return {
    lookupKey: sku.lookupKey,
    price: sticker(sku.amounts.gbp),
    // Counted from what the purchase actually grants rather than typed here.
    // Both numbers were written by hand a moment ago, which is precisely how
    // the refusal came to promise one course from a fee that grants four: a
    // number in two places stays right only until one of them moves.
    rounds: rounds === 1 ? "1 round" : `${rounds} rounds`,
  };
});
