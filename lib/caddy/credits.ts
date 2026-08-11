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
export const CADDY_QUOTAS = ["redesign", "tweak"] as const;
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
  // Four, so the fee is a discount rather than merely a bundle: £12 over four
  // is £3 a round, where the smallest top-up is £4. See docs/CADDY-TOPUPS.md —
  // the bundle has to be the best rate anyone can get, or it is the option to
  // avoid.
  redesign: 4,
  tweak: 60,
};

/** The countable one, for the copy that names it. */
export const CADDY_COURSES_PER_FEE = CADDY_GRANT_SIZE.redesign;

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
