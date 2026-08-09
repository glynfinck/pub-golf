import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import type { Database } from "@/types/database";

/**
 * Stripe's webhook: the one author of entitlements. Fulfilment lives here —
 * never on the success redirect — because only the signed event proves a
 * payment, and Stripe retries delivery until it hears 200.
 *
 * Idempotency is the schema's, not this handler's: stripe_event_id is
 * unique and a round holds one green fee, so a redelivered or racing event
 * lands on 23505 and is answered 200 all the same.
 */
export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey || !webhookSecret || !serviceKey) {
    // 503, not 400: Stripe keeps retrying, so a half-configured deploy is a
    // delivery queue waiting for its keys rather than a dropped payment.
    return Response.json({ error: "billing not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "no signature" }, { status: 400 });
  }

  const stripe = new Stripe(secretKey);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      signature,
      webhookSecret,
    );
  } catch {
    return Response.json({ error: "bad signature" }, { status: 400 });
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return Response.json({ received: true });
  }

  const session = event.data.object;
  // Async payment methods complete their sessions before the money moves;
  // those fire async_payment_succeeded later, and that firing lands here.
  if (session.payment_status !== "paid") {
    return Response.json({ received: true });
  }

  const kind = session.metadata?.kind;
  const roundId = session.metadata?.round_id;
  const userId = session.metadata?.user_id;
  // The honesty box completes checkouts too; only a green fee writes a row.
  if (kind !== "green_fee" || !roundId || !userId) {
    return Response.json({ received: true });
  }

  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await admin.from("entitlements").insert({
    user_id: userId,
    round_id: roundId,
    kind,
    stripe_event_id: event.id,
    stripe_session_id: session.id,
    // Captured now so purchase history never needs Stripe at read time.
    amount_total: session.amount_total,
    currency: session.currency,
  });
  // 23505 is the schema doing idempotency's work: already fulfilled.
  if (error && error.code !== "23505") {
    return Response.json({ error: "not recorded" }, { status: 500 });
  }
  return Response.json({ received: true });
}
