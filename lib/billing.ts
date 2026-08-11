import type Stripe from "stripe";

/** Prices resolve by lookup key, never id: a sandbox mirrors production
 * under the same keys, so code never branches on environment. */
export const GREEN_FEE_LOOKUP_KEY = "green_fee";

/**
 * More caddy, for a host whose fee has planned everything it holds.
 *
 * Two rungs and no third. Demand here is lopsided — most hosts need none,
 * some need one — and a third rung turns one honest tariff into a pricing
 * page. See docs/CADDY-TOPUPS.md for the arithmetic and for why neither
 * undercuts the fee's own £3 a round.
 *
 * The lookup key is also the entitlement `kind` and the reason stamped on the
 * grants, so one string identifies the purchase from Stripe through to the
 * ledger row. Add a rung here, add it to `CADDY_TOPUPS` and to
 * `caddy_topup_size()`, or it sells and grants nothing.
 */
export const CADDY_TOPUP_LOOKUP_KEYS = ["caddy_topup_1", "caddy_topup_3"] as const;
export type CaddyTopupKey = (typeof CADDY_TOPUP_LOOKUP_KEYS)[number];

/** What each rung grants, mirrored from `public.caddy_topup_size()` and proved
 * equal by a db test. Durable on purpose: these carry no expiry, because cost
 * is incurred at redemption and an unredeemed round costs nothing to hold. */
export const CADDY_TOPUPS: Record<
  CaddyTopupKey,
  { redesign: number; tweak: number }
> = {
  caddy_topup_1: { redesign: 1, tweak: 10 },
  caddy_topup_3: { redesign: 3, tweak: 30 },
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

/** When a pass paid at this instant runs out. */
export function dayPassExpiry(paidAtMs: number): string {
  return new Date(paidAtMs + DAY_PASS_HOURS * 3_600_000).toISOString();
}

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
