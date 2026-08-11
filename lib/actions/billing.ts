"use server";

import Stripe from "stripe";

import {
  billingEnabled,
  dayPassSessionParams,
  GREEN_FEE_LOOKUP_KEY,
} from "@/lib/billing";
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

  // Already inside a window? A second pass on the same day buys nothing but
  // refund admin. The schema cannot say this — "no overlapping live pass" is
  // not a constraint — so it is said here, kindly, and the small print
  // refunds anyone who gets past it.
  const { data: live } = await supabase
    .from("entitlements")
    .select("id")
    .eq("user_id", user.id)
    .eq("kind", "green_fee")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1)
    .maybeSingle();
  if (live) return { error: "Your green fee is already paid — it runs all day." };

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
        origin: SITE_URL,
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
