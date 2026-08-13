import type Stripe from "stripe";

/** Prices resolve by lookup key, never id: a sandbox mirrors production
 * under the same keys, so code never branches on environment. */
export const GREEN_FEE_LOOKUP_KEY = "green_fee";

/**
 * Every rung the house has ever sold, and the set it will honour for ever.
 *
 * This list only grows. A purchase is a promise: the webhook grants against
 * whatever kind Stripe hands back, `caddy_topup_size()` sizes it, and a host
 * who bought a rung two months ago must still get what they paid for long
 * after the shop stopped showing it. Taking a key *out* of here would strand
 * an in-flight checkout and silently void a grant — which is why retirement is
 * expressed by `CADDY_TOPUPS_ON_SALE` below rather than by deletion.
 *
 * The lookup key is also the entitlement `kind` and the reason stamped on the
 * grants, so one string identifies the purchase from Stripe through to the
 * ledger row. Add a rung here, add it to `CADDY_TOPUPS` and to
 * `caddy_topup_size()`, or it sells and grants nothing.
 */
export const CADDY_TOPUP_LOOKUP_KEYS = [
  "caddy_topup_1",
  "caddy_topup_3",
  "caddy_topup_course",
] as const;
export type CaddyTopupKey = (typeof CADDY_TOPUP_LOOKUP_KEYS)[number];

/**
 * What is actually on the shelf — two rungs of the same kind of thing.
 *
 * `caddy_topup_course` is retired. It sold a second course to *keep* while the
 * other two sell more goes at the course already in the book, and putting two
 * different kinds of thing on one row of three buttons was most of why the
 * sheet read as confusing: the prices ran £5, £12, £9 — a ladder that does not
 * sort, with the dearest rung in the middle — and the odd one out could not be
 * told from the other two without already knowing the one-course-per-fee rule,
 * which that sheet has never explained. Demand for it was the lopsided end of
 * a lopsided list. A host who wants a second course to keep wants it because
 * they are hosting a second night, and a green fee is what you buy to host a
 * night — at £2.40 a card it is the best rate on the board, so this rung was
 * routing that demand away from the better product.
 *
 * The price object stays live in Stripe on purpose. Archiving it would fail
 * `tests/sandbox` — which asserts every honoured key is on sale, correctly, so
 * that a rung the grant logic knows cannot 404 at the till — and buys nothing:
 * with the key off this list, `startCaddyTopupCheckout` refuses it, so no new
 * sale can start whatever a crafted request asks for.
 */
export const CADDY_TOPUPS_ON_SALE: readonly CaddyTopupKey[] = [
  "caddy_topup_1",
  "caddy_topup_3",
];

/** What each rung grants, mirrored from `public.caddy_topup_size()` and proved
 * equal by a db test. Durable on purpose: these carry no expiry, because cost
 * is incurred at redemption and an unredeemed round costs nothing to hold. */
export const CADDY_TOPUPS: Record<
  CaddyTopupKey,
  { course?: number; redesign: number; tweak: number }
> = {
  caddy_topup_1: { redesign: 1, tweak: 10 },
  caddy_topup_3: { redesign: 3, tweak: 30 },
  /**
   * Retired from the shelf, honoured for ever — see `CADDY_TOPUPS_ON_SALE`.
   * These numbers are what somebody already paid for, so they are frozen
   * rather than tidied away: the balance a past buyer reads is summed from
   * this row, and `caddy_topup_size()` still answers for it in Postgres.
   *
   * The only rung that buys a second course *kept*, rather than more goes at
   * the one in the book.
   *
   * A fee files one course, and the rule is per **purchase** —
   * `caddy_sessions_one_course_per_fee` is keyed on `entitlement_id` — so this
   * needs no exception written for it anywhere. Its own entitlement gets its
   * own slot, which is what "another course" had to mean to be worth £9.
   *
   * The revision is not optional garnish. `liveFee` resolves which purchase a
   * session works under by walking the same ladder the spend does, and a rung
   * granting a course and nothing else would leave a host with one card and
   * then no way to revise it. One revision makes it a usable little pack; the
   * ladder in `liveFee` is what makes it correct.
   */
  caddy_topup_course: { course: 1, redesign: 1, tweak: 20 },
};

/** Billing is off until the key exists — the maps-key pattern: no secret,
 * no surface, and nothing on screen mentions money. */
export function billingEnabled(secretKey: string | undefined): boolean {
  return typeof secretKey === "string" && secretKey.length > 0;
}

/**
 * The honesty box is a Stripe Payment Link, not an integration: tips grant
 * nothing, so there is no webhook and no entitlement behind them — just a
 * link out. The round code rides along as client_reference_id so the
 * dashboard can say which rounds tip.
 */
export function honestyBoxHref(
  base: string | undefined,
  roundCode: string,
): string | null {
  if (!base) return null;
  // Stripe accepts [A-Za-z0-9_-]{1,200} as a client reference.
  const ref = roundCode.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 200);
  if (!ref) return base;
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}client_reference_id=${ref}`;
}

/**
 * A green fee is a day pass, which is what the words mean on a real course:
 * it buys the day, not the round. Every round its buyer tees off inside the
 * window is stamped covered, and stays covered once it has been — the pass
 * runs out, the rounds it granted do not.
 *
 * The window is the mistake-forgiveness design as much as the product: a
 * round set up wrong can be abandoned and rebuilt inside it, so a fee is
 * never burned by a typo and no refund email needs writing.
 */
export const DAY_PASS_HOURS = 24;

/**
 * `dayPassExpiry` stood here — a purchase time plus 24 hours — and stopped
 * having a caller when `20260908000000` moved the day to tee-off. The webhook
 * writes `expires_at: null` now, and the stamp is `activate_day_pass`'s, in
 * Postgres, where the tee-off happens. A second implementation in TypeScript
 * would be a second answer to when a host's day ends.
 */


/** Is this pass still running? `null` expiry never runs out — the column's
 * own contract, and how a comped pass would read. */
export function dayPassLive(
  expiresAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (expiresAt === null || expiresAt === undefined) return true;
  const runsOut = Date.parse(expiresAt);
  return Number.isNaN(runsOut) ? false : runsOut > nowMs;
}

/**
 * Why a second green fee is refused, or null to let the sale through.
 *
 * Pure, and split out of `startGreenFeeCheckout` because it is the one piece
 * of that action with an opinion — everything else is a Stripe call. It had a
 * bug that only a test would have caught, and there was no way to write one.
 *
 * The bug: since the fee's day starts at tee-off rather than at purchase,
 * `expires_at` is null on a fee nobody has used, and the guard read null as
 * "live". So a host who bought a fee, planned their courses, spent every
 * credit and never teed a round off was locked out of buying another — told
 * that the thing they had just used up was "already paid".
 *
 * A **running** fee refuses: it is doing something, all day, and a second
 * would overlap it. A **dormant** fee refuses only while it can still do
 * something. A dormant fee with nothing left is finished in every sense except
 * the column, and finished things do not block sales.
 */
export function secondFeeRefusal(input: {
  /** The buyer's most relevant unexpired fee: its expiry, `null` when the fee
   * is dormant, or `undefined` when they hold none at all. */
  liveExpiresAt: string | null | undefined;
  /** Whether that fee can still plan or tweak anything. Only consulted for a
   * dormant one — a running fee blocks whatever its ledger says, because the
   * day pass is more than the caddy. */
  canStillPlan: boolean;
}): string | null {
  if (input.liveExpiresAt === undefined) return null;
  if (input.liveExpiresAt !== null) {
    return "Your green fee is already paid — it runs all day.";
  }
  if (input.canStillPlan) {
    return "Your green fee is already paid — its day starts when you tee off.";
  }
  return null;
}

/**
 * Why a top-up is refused to this buyer, or null to let the sale through.
 *
 * A top-up adds goes to a green fee; it has never been a way in on its own.
 * For a while it was exactly that: nothing between `startCaddyTopupCheckout`
 * and the ledger asked whether a fee existed, and `guard_caddy_spend`'s
 * ladder happily pays for a whole first card out of a top-up's re-design
 * grant — so a buyer could take the caddy's entire product for the price of
 * one extra go and never buy the fee it was priced to extend.
 * `tests/unit/caddy-credits.test.ts` holds the rule that no rung may sell a
 * card cheaper than the fee does, and this is the same rule at the door: a
 * rung that sells *without* the fee undercuts it whatever it costs.
 *
 * The till is the only honest place to say no. Fulfilment honours whatever
 * was sold — a purchase is a promise, and the webhook grants against any
 * completed checkout — so the refusal has to come before the money moves,
 * exactly as `secondFeeRefusal` does for the fee itself. Nothing changes on
 * the spending side on purpose: credits already sold to a fee-less account
 * were sold, and the ledger keeps answering for them.
 *
 * **Any fee counts, however long ago its day ran out** — which is why this
 * takes the rows and ignores their expiries rather than being handed a
 * pre-filtered "live" list. The goes a top-up buys are durable by design
 * ("yours to keep — these don't run out with the day"), and the pipeline
 * offers more caddy to a host whose day has just ended (`PASS_RAN_OUT`);
 * gating this on a live pass would make that offer a dead end at its own
 * till. Expiry ends the pass, not the membership. What does stop counting is
 * a refund: a refunded fee's row is deleted with its grants, so it stops
 * answering here by the same cascade.
 */
export function topupRefusal(input: {
  /** Every green fee on the buyer's account, as the rows read — expired ones
   * included, refunded ones already gone. */
  fees: { expiresAt: string | null }[];
}): string | null {
  if (input.fees.length > 0) return null;
  return "A top-up adds goes to a green fee, and there isn't one on this account yet. Start with the fee — it comes with goes of its own.";
}

/**
 * What the green fee buys today.
 *
 * Listed on the members' options group and nowhere else — and it lists what
 * exists, never what is planned. That is the covenant's "money only ever
 * buys something real" as a rule about this array: the printed pack and the
 * table's colours join it on the day they ship, not before.
 *
 * The league used to be on this list and is now free for everyone. Taking a
 * paid extra *off* the list is the one direction the covenant allows — "what's
 * free stays free" forbids the reverse, never this — and it was the right way
 * round: a league is the game keeping score of itself, so charging for it
 * priced the sport rather than the service. What the fee buys is the caddy
 * doing an evening's legwork, which is a thing done *for* you rather than a
 * part of the game withheld from you.
 */
export const GREEN_FEE_EXTRAS = [
  {
    title: "The caddy",
    detail: "one course, planned for you — yours to change or replace",
  },
] as const;

/**
 * Where Stripe should send the buyer back to: the origin they are actually on.
 *
 * Both checkout actions used to build their return URLs from `SITE_URL`, which
 * is `NEXT_PUBLIC_SITE_URL` or a hardcoded `https://pub-golf.glyn.dev`. On
 * production those agree and nothing was ever wrong. Anywhere else they do
 * not: paying on preview handed you back to the **live site**, on a different
 * Supabase project, with no entitlement to show for it — the purchase
 * succeeded, the webhook fulfilled it on preview, and the buyer was looking at
 * production wondering where it went. That makes end-to-end testing a paid
 * flow off production impossible to read, which is exactly what it is for.
 *
 * Vercel gives every deployment its own hostname, so the only origin that is
 * always right is the request's own. `dayPassSessionParams` already took an
 * `origin` — it was being handed a constant.
 *
 * Pure, and taking `Headers`, per `ipBiasFrom` in `lib/pub-search.ts`: the
 * request-scoped read stays in the action and the decision stays testable.
 *
 * The header is not a trust boundary here and does not need to be. The return
 * URL carries no token and grants nothing — fulfilment is the webhook's, off
 * the signed event — so a spoofed host redirects the spoofer to their own page
 * and buys them exactly what they paid for.
 */
export function checkoutOrigin(headers: Headers, fallback: string): string {
  // Vercel sets x-forwarded-host to the hostname the browser asked for;
  // `host` is the internal one. Comma-joined when proxies stack, and the
  // first entry is the client's.
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "")
    .split(",")[0]
    .trim();
  if (!host) return fallback;
  const proto =
    (headers.get("x-forwarded-proto") ?? "").split(",")[0].trim() || "https";
  return `${proto}://${host}`;
}

/**
 * Checkout Session params for one day pass. Pure so the shape is testable:
 * the webhook trusts nothing but what it reads back out of this metadata, so
 * the metadata is the fulfilment contract.
 *
 * No round anywhere in it — the pass predates the rounds it will cover, and
 * is bought from the new-round form before one exists.
 */
export function dayPassSessionParams(input: {
  priceId: string;
  userId: string;
  origin: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    line_items: [{ price: input.priceId, quantity: 1 }],
    client_reference_id: input.userId,
    // The webhook is the source of truth; the success URL is only a way home,
    // back to the table the host was setting when they stepped out to pay.
    success_url: `${input.origin}/new?fee=paid`,
    cancel_url: `${input.origin}/new`,
    metadata: {
      kind: "green_fee",
      user_id: input.userId,
    },
  };
}
