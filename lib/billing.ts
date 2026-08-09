import type Stripe from "stripe";

/** Prices resolve by lookup key, never id: a sandbox mirrors production
 * under the same keys, so code never branches on environment. */
export const GREEN_FEE_LOOKUP_KEY = "green_fee";

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
 * Checkout Session params for one green fee on one round. Pure so the shape
 * is testable: the webhook trusts nothing but what it reads back out of this
 * metadata, so the metadata is the fulfilment contract.
 */
export function greenFeeSessionParams(input: {
  priceId: string;
  roundId: string;
  roundCode: string;
  userId: string;
  origin: string;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    line_items: [{ price: input.priceId, quantity: 1 }],
    client_reference_id: input.roundId,
    // The webhook is the source of truth; the success URL is only a way home.
    success_url: `${input.origin}/round/${input.roundCode}?fee=paid`,
    cancel_url: `${input.origin}/round/${input.roundCode}`,
    metadata: {
      kind: "green_fee",
      round_id: input.roundId,
      round_code: input.roundCode,
      user_id: input.userId,
    },
  };
}
