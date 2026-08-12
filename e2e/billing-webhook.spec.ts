import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

/**
 * The fulfilment loop, end to end and offline: a checkout.session.completed
 * event — signed with the same secret the app holds, using Stripe's own
 * generateTestHeaderString — lands on the real webhook route, and the
 * entitlement row lands in real Postgres. No request ever leaves the
 * machine: the dummy STRIPE_SECRET_KEY only has to be non-empty for the
 * route to consider billing configured, and signature verification is pure
 * crypto. That keeps the whole payment loop inside the PR gate's rules —
 * deterministic, no third-party network, nothing to flake.
 *
 * What is fulfilled is a **dormant day pass**: a row on the buyer with no
 * round on it and *no clock running*. The day starts at tee-off, not at
 * purchase (`20260908000000`), so the webhook writes a null `expires_at` and
 * `activate_day_pass` stamps the twenty-four hours when a round actually tees
 * off. No round is seeded here because none is involved — the pass is bought
 * from the new-round form before a round exists, and what a round keeps is
 * the members' flag stamped into its own ruleset at tee-off (proved in
 * tests/db/rls-day-pass.test.ts).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// API-only: the spec never opens a page, so it runs on one project only —
// the other two ignore it in playwright.config.ts (not a runtime skip,
// which would still run afterAll in a worker whose beforeAll never ran).
// Without billing env the route answers 503 by design; a dummy pair in
// .env.local (see .env.example) turns the loop on.
test.skip(
  !WEBHOOK_SECRET,
  "needs STRIPE_WEBHOOK_SECRET (a dummy will do) in .env.local",
);

const stripe = new Stripe("sk_test_never_called");

/** Fixed so the expiry is arithmetic rather than a race with the clock. */
const PAID_AT = Math.floor(Date.parse("2026-08-09T19:30:00.000Z") / 1000);

function signedEvent(input: {
  eventId: string;
  sessionId: string;
  paymentStatus?: string;
  created?: number;
  metadata: Record<string, string>;
}): { payload: string; signature: string } {
  const payload = JSON.stringify({
    id: input.eventId,
    object: "event",
    type: "checkout.session.completed",
    created: input.created ?? PAID_AT,
    data: {
      object: {
        id: input.sessionId,
        object: "checkout.session",
        payment_status: input.paymentStatus ?? "paid",
        amount_total: 400,
        currency: "gbp",
        metadata: input.metadata,
      },
    },
  });
  return {
    payload,
    signature: stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET!,
    }),
  };
}

const admin = () =>
  createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function passesFor(userId: string) {
  const { data, error } = await admin()
    .from("entitlements")
    .select(
      "id, stripe_event_id, round_id, amount_total, currency, expires_at, activated_at",
    )
    .eq("user_id", userId)
    .eq("kind", "green_fee");
  if (error) throw error;
  return data;
}

async function newHost(name: string): Promise<string> {
  const { data, error } = await admin().auth.admin.createUser({
    email: `webhook-spec-${randomUUID()}@test.local`,
    password: "e2e-not-a-secret-password",
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  return data.user.id;
}

let buyer: string;
let quiet: string;

test.beforeAll(async () => {
  [buyer, quiet] = await Promise.all([
    newHost("Webhook Spec Buyer"),
    newHost("Webhook Spec Bystander"),
  ]);
});

test.afterAll(async () => {
  // Nothing to tear down when the file was skipped before beforeAll ran.
  if (!buyer) return;
  // The user cascades the profile, which cascades its entitlements.
  const db = admin();
  await db.auth.admin.deleteUser(buyer);
  await db.auth.admin.deleteUser(quiet);
});

test("refuses an unsigned delivery", async ({ request }) => {
  const response = await request.post("/api/billing/webhook", {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ id: "evt_unsigned", object: "event" }),
  });
  expect(response.status()).toBe(400);
});

test("refuses a forged signature", async ({ request }) => {
  const { payload } = signedEvent({
    eventId: `evt_forged_${randomUUID().replaceAll("-", "")}`,
    sessionId: "cs_forged",
    metadata: { kind: "green_fee", user_id: quiet },
  });
  const forged = new Stripe("sk_test_never_called").webhooks
    .generateTestHeaderString({ payload, secret: "whsec_someone_else" });
  const response = await request.post("/api/billing/webhook", {
    headers: {
      "content-type": "application/json",
      "stripe-signature": forged,
    },
    data: payload,
  });
  expect(response.status()).toBe(400);
  expect(await passesFor(quiet)).toEqual([]);
});

test("mints one dormant day pass, however often Stripe redelivers", async ({
  request,
}) => {
  const { payload, signature } = signedEvent({
    eventId: `evt_e2e_${randomUUID().replaceAll("-", "")}`,
    sessionId: `cs_e2e_${randomUUID().replaceAll("-", "")}`,
    metadata: { kind: "green_fee", user_id: buyer },
  });
  const headers = {
    "content-type": "application/json",
    "stripe-signature": signature,
  };

  // Stripe retries until it hears 200, so the same event arriving twice must
  // grant one pass — the schema's unique stripe_event_id is what says so.
  const first = await request.post("/api/billing/webhook", {
    headers,
    data: payload,
  });
  expect(first.status()).toBe(200);
  const redelivered = await request.post("/api/billing/webhook", {
    headers,
    data: payload,
  });
  expect(redelivered.status()).toBe(200);

  const rows = await passesFor(buyer);
  expect(rows).toHaveLength(1);
  // No round on it: a day pass predates every round it will cover.
  expect(rows[0].round_id).toBeNull();
  // The paid amount rides along, so purchase history reads from Postgres.
  expect(rows[0].amount_total).toBe(400);
  expect(rows[0].currency).toBe("gbp");
  /**
   * **No clock on it yet**, and that is the whole of what `20260908000000`
   * changed. This used to assert `expires_at === PAID_AT + 24h`, dated from
   * the event so a slow Stripe retry could not hand out a longer day than was
   * paid for. Since the day starts at tee-off the webhook writes null, and
   * `Date.parse(null)` is `NaN` — so the assertion failed rather than quietly
   * passing, which is the one good thing about it having gone stale.
   *
   * A host buying on a Wednesday for Saturday's crawl is the case this
   * protects: nothing is burning until they tee a round off.
   */
  expect(rows[0].expires_at).toBeNull();
  expect(rows[0].activated_at).toBeNull();
});

test("writes nothing for a tip, an unpaid session, or a session with no buyer", async ({
  request,
}) => {
  const cases: {
    metadata: Record<string, string>;
    paymentStatus?: string;
  }[] = [
    // The honesty box completes checkouts too, and grants nothing.
    { metadata: { kind: "tip" } },
    { metadata: { kind: "green_fee", user_id: quiet }, paymentStatus: "unpaid" },
    // Metadata is the fulfilment contract; without a buyer there is nobody
    // to grant a pass to, and guessing one is how money grants the wrong day.
    { metadata: { kind: "green_fee" } },
  ];

  for (const shape of cases) {
    const { payload, signature } = signedEvent({
      eventId: `evt_e2e_${randomUUID().replaceAll("-", "")}`,
      sessionId: `cs_e2e_${randomUUID().replaceAll("-", "")}`,
      ...shape,
    });
    const response = await request.post("/api/billing/webhook", {
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      data: payload,
    });
    expect(response.status()).toBe(200);
  }
  expect(await passesFor(quiet)).toEqual([]);
});
