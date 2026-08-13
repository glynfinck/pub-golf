import { CADDY_TOPUPS, CADDY_TOPUPS_ON_SALE } from "@/lib/billing";
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
 * Hand-kept mirror of the `public.caddy_quota` enum and of
 * `caddy_grant_size()`, proved equal by a db test — a number the screen
 * misquotes is a host told they have something they do not. (It used to name
 * `caddy_courses_per_fee()`, which the ledger migration `20260831000000`
 * dropped; the mirror is real, the function it named is not.)
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
  // £5 for one. The bundle has to be the best rate
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

/**
 * How the remaining cards read on screen.
 *
 * Plain, and never a bare digit — "2" beside a button is a badge nobody can
 * parse.
 *
 * **Goes, not courses**, and the distinction is the one thing this app most
 * needs its words to keep straight. A fee keeps *one* course; what it gives
 * four more of is attempts at it, each of which writes over the last. Saying
 * "5 courses left on this fee" promised five saved cards and delivered one,
 * which is the exact conflation the one-course rule exists to prevent —
 * `tearOutNotice`, written later, already had the right register.
 *
 * "On this fee" is gone for a second reason: the balance is summed across
 * durable top-up grants too, so a host who bought a pack was being told their
 * permanent credits belonged to a day that is about to end.
 */
export function coursesLeftNote(left: number): string {
  if (left <= 0) return "No goes left at it";
  return left === 1 ? "One more go at it" : `${left} more goes at it`;
}

/**
 * What a host should know before the caddy starts a fresh course.
 *
 * Two facts, and both of them are things somebody has found out the hard way.
 *
 *   **Planning starts no clock.** This sheet was written when it did — the
 *   day ran from the charge, so a host buying on Wednesday to plan a Saturday
 *   crawl had a dead pass by Thursday. `20260908000000` moved the start to
 *   tee-off, and the sheet now says so, because "am I burning my fee by
 *   planning this now" is the question a host is actually asking when they
 *   hesitate over the button.
 *
 *   **A fresh course replaces the one they have.** A fee files one course
 *   (`caddy_sessions_one_course_per_fee`), so planning again writes over it.
 *   That is the rule working, but it is destructive, and doing it silently
 *   would be the app throwing away an evening's work without asking.
 *
 * Coarse on the time, via `formatTimeLeft`, and for its reason: a day pass is
 * not a shot clock and a minute-accurate figure reads as pressure. No price
 * and no offer here either — this is a confirmation, not a checkout.
 *
 * Returns the lines in the order they should be read. Empty means there is
 * nothing worth stopping for.
 */
export function freshCourseNotice(input: {
  /**
   * Whether the fee's day has started. A dormant fee is the ordinary case for
   * somebody planning ahead — bought, covering them, no clock running — and it
   * is the reassurance worth leading with, because the old model made this
   * exact moment the one that quietly cost them their pass.
   */
  dormant: boolean;
  /** From `formatTimeLeft`, or null before the first client tick — in which
   * case the fact is stated without the figure rather than with a wrong one. */
  timeLeft: string | null;
  /** Whether a course from this fee is already in the book. */
  replacing: boolean;
  /** Whole cards left after this one, so a host knows what they are down to. */
  cardsLeftAfter: number;
}): string[] {
  const lines: string[] = [];
  if (input.replacing) {
    lines.push(
      "This writes over the course your fee already filed. The old one goes.",
    );
  }
  lines.push(
    input.dormant
      ? "Planning starts no clock. Your fee's day begins when you tee the round off, so plan as far ahead as you like."
      : input.timeLeft
        ? `Your green fee's day has ${input.timeLeft} to run, and the caddy works inside it.`
        : "Your green fee's day is already running, and the caddy works inside it.",
  );
  if (input.cardsLeftAfter <= 0) {
    lines.push("This is the last whole card on it — tweaks will still be free.");
  } else if (input.cardsLeftAfter === 1) {
    lines.push("One more after this one.");
  } else {
    lines.push(`${input.cardsLeftAfter} more after this one.`);
  }
  return lines;
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
 * stops. It also says which ways on are actually open, because a host being
 * told "the caddy can't rebuild this" needs the alternatives in the same
 * breath as the warning — that is the whole of the requirement this answers,
 * and answering it in prose alone left the two doors unbuilt for a release.
 *
 * The sentence and the doors are decided together, here, rather than in the
 * sheet: which ways on exist follows from the same two counts as the wording
 * does, and a screen re-deriving them is a second place for them to disagree.
 *
 * Null for a hand-plotted course, which has nothing to do with any of this.
 */
export interface TearOutNotice {
  /** What is true, in one sentence. */
  line: string;
  /** Whether the caddy could plan a replacement for what is about to go. When
   * it could not, the sheet offers more caddy — and only then. */
  canReplace: boolean;
  /** Whether changing this course instead is still a thing they can do. The
   * "just tweak it" door, and the reason the warning is not a dead end. */
  canTweak: boolean;
}

export function tearOutNotice(input: {
  /** Whether the caddy planned this one. A course somebody typed out by hand
   * costs nothing to rebuild and gets no warning. */
  caddyPlanned: boolean;
  /** Whole cards left on the fee — the course credit and the revisions
   * together, which is what `caddyAllowance` reports. */
  cardsLeft: number;
  tweaksLeft: number;
}): TearOutNotice | null {
  if (!input.caddyPlanned) return null;
  const canTweak = input.tweaksLeft > 0;
  if (input.cardsLeft > 0) {
    const goes =
      input.cardsLeft === 1
        ? "one more go at it"
        : `${input.cardsLeft} more goes at it`;
    return {
      line: `Tearing this out frees your fee to plan another — you have ${goes}.`,
      canReplace: true,
      canTweak,
    };
  }
  if (canTweak) {
    return {
      line: "This fee has no more courses in it, so the caddy can't plan you a replacement. Changing this one is still free, and there are tweaks left on it.",
      canReplace: false,
      canTweak: true,
    };
  }
  return {
    line: "This fee has no more courses and no tweaks left. Tear this out and the caddy can't rebuild it — though the drafting table is free, as always.",
    canReplace: false,
    canTweak: false,
  };
}

/**
 * What one go buys, said where it is sold.
 *
 * The shelf went out without this, and the missing sentence is most of why it
 * read as confusing. A unit nobody has defined has to be guessed from its own
 * name, so the name was carrying weight no single word can: a host had to
 * infer both that a go produces a whole fresh card *and* that the new card
 * replaces the one they have. The second half is the one that stings if you
 * learn it afterwards, which is the same argument `freshCourseNotice` already
 * makes at the other door — this is that warning arriving before the money
 * rather than after it.
 *
 * Two short facts, in the order a buyer needs them. No count and no clock: the
 * covenant's line about countdown timers is about manufactured urgency, and a
 * definition is neither.
 */
export const WHAT_A_GO_BUYS =
  "A go is one fresh plan of your course. You keep the newest one.";

/**
 * The condition on the unit, said in the same breath as the unit.
 *
 * `topupRefusal` is the enforcement — the till turns a fee-less buyer away —
 * and this is the warning that means nobody meets that refusal ignorant. It
 * renders in the hazard tone on both surfaces that show a top-up price (the
 * refusal sheet and `/tariff`), because "these only work over a green fee" is
 * the one fact about the product that, missed, reads later as a trick: a £5
 * line under a £12 line invites exactly the wrong-way-round purchase the
 * gate exists to stop.
 *
 * One constant for both surfaces, the same argument as `WHAT_A_GO_BUYS`
 * directly above: a condition worded twice is two conditions the moment one
 * of them is edited.
 */
export const WHAT_A_GO_NEEDS =
  "Goes ride on a green fee — a top-up adds them to your fee and can't stand in for one.";

/** The board, reachable by lookup key. Built from the tariff entries' own
 * keys rather than typed out, so it cannot mis-map a rung onto another rung's
 * price — the failure this file keeps having is a number in two places. */
const TARIFF_BY_KEY = new Map(
  [TARIFF.caddyTopupOne, TARIFF.caddyTopupThree, TARIFF.caddyTopupCourse].map(
    (sku) => [sku.lookupKey, sku] as const,
  ),
);

/**
 * What the refusal sheet offers, and the only place more caddy is *offered*.
 *
 * Two rungs of the same kind of thing — one go, or three. Both buy more goes
 * at the course in the book, which is what lets the shelf sort by price and be
 * read straight down. It stops at two because a third would be another *size*,
 * which is where one honest tariff turns into a pricing page.
 *
 * Driven off `CADDY_TOPUPS_ON_SALE` rather than the full key list, and that is
 * the whole of how a rung retires: the ledger honours every key it ever sold
 * (`CADDY_TOPUP_LOOKUP_KEYS`), the shelf shows the ones still for sale, and
 * `caddy_topup_course` is now only the former. Mapping the full list here is
 * what would put it back on sale.
 *
 * Prices are derived from `TARIFF` rather than written here, so the board and
 * the button cannot disagree. `tests/unit/caddy-credits.test.ts` holds the
 * arithmetic behind them and the rule that no rung may sell a card below what
 * the fee implies. `/tariff` lists both as well, which is disclosure rather
 * than offering — see `tests/unit/covenant-money.test.ts`.
 *
 * The goes are described, never counted down. A host reads "3 more goes"
 * because that is what they are buying, not because anything is running out.
 *
 * **Goes, not rounds**, and this is the second time that distinction has had
 * to be made — `coursesLeftNote` made it for the badge, and this shelf, written
 * later, did not inherit it. A `round` in this app is a night of pub golf: a
 * table, a join code, the thing the league counts a player's in. So the same
 * two words rendered "3 rounds" on the league table meaning three nights
 * played and "3 rounds" on this button meaning three attempts at one course.
 * The damage was not only ambiguity — the £12 three-pack sat one line under
 * the £12 green fee on `/tariff`, so the word made the fee look like the worse
 * buy at identical money, which is the exact opposite of what the ladder is
 * priced to do. The badge above this shelf already said "3 more goes at it".
 * Now the shelf agrees with it.
 */
export const CADDY_TOPUP_OFFERS = CADDY_TOPUPS_ON_SALE.map((lookupKey) => {
  const sku = TARIFF_BY_KEY.get(lookupKey);
  if (!sku) throw new Error(`${lookupKey} is on sale with no price on the board`);
  const grant = CADDY_TOPUPS[lookupKey];
  // Every whole card the rung buys, both rungs of the ladder together, because
  // `guard_caddy_spend` spends them in order and a host cannot tell which one
  // paid for the card in front of them.
  const cards = (grant.course ?? 0) + grant.redesign;
  return {
    lookupKey,
    price: sticker(sku.amounts.gbp),
    // Counted from what the purchase actually grants rather than typed here.
    // Both numbers were written by hand once, which is precisely how the
    // refusal came to promise one course from a fee that grants four: a number
    // in two places stays right only until one of them moves.
    //
    // Worded exactly as `coursesLeftNote` words the badge — spelled out for
    // one, a digit above that — because they are the same quantity in the same
    // sentence six inches apart, and a host reading "one more go" under a badge
    // reading "One more go at it" should not have to wonder whether two
    // different things are being counted.
    goes: cards === 1 ? "one more go" : `${cards} more goes`,
  };
});
