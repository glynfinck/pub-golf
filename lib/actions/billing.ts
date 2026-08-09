"use server";

import Stripe from "stripe";

import {
  billingEnabled,
  GREEN_FEE_LOOKUP_KEY,
  greenFeeSessionParams,
} from "@/lib/billing";
import { SITE_URL } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Start a green-fee checkout for a round and hand back the Stripe-hosted
 * URL. Officials only — the host pays, never the table. Fulfilment happens
 * on the webhook (app/api/billing/webhook), never here: this action's only
 * job is to open the till.
 */
export async function startGreenFeeCheckout(
  code: string,
): Promise<{ url?: string; error?: string }> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!billingEnabled(secretKey)) {
    return { error: "The till isn't plugged in yet." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to add the green fee." };

  const { data: round } = await supabase
    .from("rounds")
    .select("id, code, round_players!inner(role, profile_id)")
    .eq("code", code.toUpperCase())
    .eq("round_players.profile_id", user.id)
    .maybeSingle();
  if (!round) return { error: "That round isn't on your card." };
  const seat = round.round_players[0];
  if (!seat || !["host", "caddy"].includes(seat.role)) {
    return { error: "Only the round's officials can add the green fee." };
  }

  // Already on the card? A second checkout is refund admin, not revenue.
  // (The schema holds the real line — one green fee per round — this check
  // just spares an honest host the trip to Stripe and back.)
  const { data: existing } = await supabase
    .from("entitlements")
    .select("id")
    .eq("round_id", round.id)
    .eq("kind", "green_fee")
    .maybeSingle();
  if (existing) return { error: "The green fee is already on this round." };

  try {
    const stripe = new Stripe(secretKey as string);
    const prices = await stripe.prices.list({
      lookup_keys: [GREEN_FEE_LOOKUP_KEY],
      limit: 1,
    });
    const price = prices.data[0];
    if (!price) return { error: "The green fee isn't on the tariff yet." };

    const session = await stripe.checkout.sessions.create(
      greenFeeSessionParams({
        priceId: price.id,
        roundId: round.id,
        roundCode: round.code,
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
