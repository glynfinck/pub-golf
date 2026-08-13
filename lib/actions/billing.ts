"use server";

import { headers } from "next/headers";
import Stripe from "stripe";

import {
  billingEnabled,
  CADDY_TOPUPS_ON_SALE,
  checkoutOrigin,
  dayPassSessionParams,
  GREEN_FEE_LOOKUP_KEY,
  secondFeeRefusal,
  topupRefusal,
} from "@/lib/billing";
import { caddyAllowance } from "@/lib/data/caddy";
import { SITE_URL } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Open the till for one green fee and hand back the Stripe-hosted URL.
 *
 * The fee is a day pass on the buyer, not a line on a round, so this takes
 * no round and needs none to exist: it is offered from the new-round form,
 * where the host is deciding what kind of round this is and there is nothing
 * created yet. Fulfilment happens on the webhook
 * (app/api/billing/webhook), never here — this action's only job is to open
 * the till.
 */
export async function startGreenFeeCheckout(): Promise<{
  url?: string;
  error?: string;
}> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!billingEnabled(secretKey)) {
    return { error: "The till isn't plugged in yet." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to add the green fee." };
  // Guests never cross the payment boundary — the covenant's first rule, and
  // an anonymous seat cannot host a round for the pass to cover anyway.
  if (user.is_anonymous) {
    return { error: "Hosting a round takes a Google sign-in." };
  }

  /**
   * Already holding one? A second pass buys nothing but refund admin. The
   * schema cannot say this — "no overlapping live pass" is not a constraint —
   * so it is said here, kindly, and the small print refunds anyone who gets
   * past it.
   *
   * **A row is not the question, though; what the row can still do is.** Since
   * the fee's day starts at tee-off rather than at purchase, `expires_at` is
   * null on a fee that has not been used — and a null read as "live" locked
   * out the one host who most wanted to buy again: somebody who bought a fee,
   * planned their courses, spent every credit and never teed a round off. That
   * fee is finished in every sense except the one column, and the block told
   * them the thing they had just used up was "already paid".
   *
   * So a *running* fee blocks — it is doing something, all day, and a second
   * one would overlap it. A dormant one blocks only while it still has
   * something to spend.
   */
  const { data: live } = await supabase
    .from("entitlements")
    .select("expires_at")
    .eq("user_id", user.id)
    .eq("kind", "green_fee")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("expires_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  // A dormant fee's credits are what is left of it, read through the same
  // function the drafting table reads — which answers "yes, plenty" when the
  // ledger is mid-deploy, and blocking is the safe side of that guess: a
  // purchase refused wrongly is a sentence, a purchase allowed wrongly is a
  // charge. A running fee never asks, so this only costs a round trip on the
  // one branch that needs it.
  const dormant = live !== null && live.expires_at === null;
  const allowance = dormant ? await caddyAllowance() : null;
  const refusal = secondFeeRefusal({
    liveExpiresAt: live ? live.expires_at : undefined,
    canStillPlan: allowance !== null && (allowance.canPlan || allowance.tweaks > 0),
  });
  if (refusal) return { error: refusal };

  try {
    const stripe = new Stripe(secretKey as string);
    const prices = await stripe.prices.list({
      lookup_keys: [GREEN_FEE_LOOKUP_KEY],
      limit: 1,
    });
    const price = prices.data[0];
    if (!price) return { error: "The green fee isn't on the tariff yet." };

    const session = await stripe.checkout.sessions.create(
      dayPassSessionParams({
        priceId: price.id,
        userId: user.id,
        // The origin the buyer is actually on, not the one this build was
        // compiled for — see `checkoutOrigin`. `SITE_URL` is the fallback for
        // a context with no request headers, which is where it was right.
        origin: checkoutOrigin(await headers(), SITE_URL),
      }),
    );
    if (!session.url) {
      return { error: "Stripe didn't offer a checkout. Give it another go." };
    }
    return { url: session.url };
  } catch {
    return { error: "The till didn't answer. Give it another go." };
  }
}

/**
 * Open the till for more caddy.
 *
 * Deliberately unlike the green fee above in two ways. There is no
 * already-have-one guard, because a top-up is a quantity rather than a state:
 * buying a second is buying more, not buying the same thing twice. And nothing
 * it grants expires — the webhook writes a null `expires_at`, because the cost
 * of a round is incurred when it is redeemed and an unredeemed one costs
 * nothing to hold.
 *
 * Like the fee, though, it refuses before it sells. A top-up adds goes to a
 * green fee, so a buyer with no fee behind the account meets `topupRefusal`
 * rather than a checkout — see that function for why the gate lives at the
 * till and why any fee counts, however long expired. Selling without it was
 * the caddy's whole product for the price of one go.
 *
 * The lookup key is also the entitlement kind and the reason on the ledger
 * row, so one string carries the purchase from here to the grant. It is
 * checked against the code's own list rather than trusted, so a crafted call
 * cannot mint a kind the webhook would then fulfil.
 */
export async function startCaddyTopupCheckout(
  lookupKey: string,
): Promise<{ url?: string; error?: string }> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!billingEnabled(secretKey)) {
    return { error: "The till isn't plugged in yet." };
  }
  // Against what is *on sale*, not against every key the ledger honours. The
  // two lists differ the moment a rung retires, and this is the side that has
  // to be strict: `caddy_topup_course` still has a live price object in Stripe
  // (the sandbox suite asserts every honoured key does, so a grantable rung can
  // never 404 at the till), so checking the honoured list would let a crafted
  // request buy something the house has taken off the board.
  if (!(CADDY_TOPUPS_ON_SALE as readonly string[]).includes(lookupKey)) {
    return { error: "That isn't on the tariff." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to add more caddy." };
  if (user.is_anonymous) {
    return { error: "Hosting a round takes a Google sign-in." };
  }

  // The fee-first gate. Every fee the buyer has ever bought, expiries and all
  // — no liveness filter, because `topupRefusal` is the one that decides and
  // it decides on existence. RLS already scopes the table to the owner's own
  // rows; the `eq` restates it the way `getDayPass` does. Refunded fees are
  // deleted rows, so they answer here exactly as they answer everywhere.
  const { data: fees, error: feeError } = await supabase
    .from("entitlements")
    .select("expires_at")
    .eq("user_id", user.id)
    .eq("kind", "green_fee")
    .limit(1);
  // An unanswered read refuses nothing and sells nothing. "No fee on this
  // account" is a sentence about their account, and a hiccup is not evidence
  // for it — but a sale on a guess re-opens the door this gate closes, so the
  // answer is "try again" rather than either.
  if (feeError) return { error: "The till didn't answer. Give it another go." };
  const refusal = topupRefusal({
    fees: (fees ?? []).map((row) => ({ expiresAt: row.expires_at })),
  });
  if (refusal) return { error: refusal };

  try {
    const stripe = new Stripe(secretKey as string);
    const prices = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
    const price = prices.data[0];
    if (!price) return { error: "That isn't on the tariff yet." };

    // The drafting table they were standing at, on the deployment they were
    // standing on. Built from the request rather than from `SITE_URL`, which
    // sent every preview purchase home to production — see `checkoutOrigin`.
    const origin = checkoutOrigin(await headers(), SITE_URL);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: price.id, quantity: 1 }],
      client_reference_id: user.id,
      success_url: `${origin}/courses/new?caddy=topped-up`,
      cancel_url: `${origin}/courses/new`,
      metadata: { kind: lookupKey, user_id: user.id },
    });
    if (!session.url) {
      return { error: "Stripe didn't offer a checkout. Give it another go." };
    }
    return { url: session.url };
  } catch {
    return { error: "The till didn't answer. Give it another go." };
  }
}
