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

function signedEvent(input: {
  eventId: string;
  sessionId: string;
  paymentStatus?: string;
  metadata: Record<string, string>;
}): { payload: string; signature: string } {
  const payload = JSON.stringify({
    id: input.eventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: input.sessionId,
        object: "checkout.session",
        payment_status: input.paymentStatus ?? "paid",
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

async function seedRound(hostId: string): Promise<string> {
  const { data, error } = await admin()
    .from("rounds")
    .insert({
      name: "webhook-spec round",
      host: hostId,
      status: "live",
      current_hole: 1,
      ruleset: {
        format: "stroke",
        hazards: true,
        holeTimerMinutes: null,
        softSubstituteScoresPar: true,
        penalties: [],
      },
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function greenFeeRows(roundId: string) {
  const { data, error } = await admin()
    .from("entitlements")
    .select("id, stripe_event_id, user_id")
    .eq("round_id", roundId)
    .eq("kind", "green_fee");
  if (error) throw error;
  return data;
}

let hostId: string;
let paidRound: string;
let quietRound: string;

test.beforeAll(async () => {
  const { data, error } = await admin().auth.admin.createUser({
    email: `webhook-spec-${randomUUID()}@test.local`,
    password: "e2e-not-a-secret-password",
    email_confirm: true,
    user_metadata: { display_name: "Webhook Spec Host" },
  });
  if (error) throw error;
  hostId = data.user.id;
  [paidRound, quietRound] = await Promise.all([
    seedRound(hostId),
    seedRound(hostId),
  ]);
});

test.afterAll(async () => {
  // Nothing to tear down when the file was skipped before beforeAll ran.
  if (!hostId) return;
  // Rounds cascade their entitlements; the user cascades the profile.
  const db = admin();
  await db.from("rounds").delete().in("id", [paidRound, quietRound]);
  await db.auth.admin.deleteUser(hostId);
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
    metadata: { kind: "green_fee", round_id: paidRound, user_id: hostId },
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
  expect(await greenFeeRows(paidRound)).toEqual([]);
});

test("fulfils a paid green fee exactly once, however often Stripe redelivers", async ({
  request,
}) => {
  const eventId = `evt_e2e_${randomUUID().replaceAll("-", "")}`;
  const { payload, signature } = signedEvent({
    eventId,
    sessionId: `cs_e2e_${randomUUID().replaceAll("-", "")}`,
    metadata: { kind: "green_fee", round_id: paidRound, user_id: hostId },
  });
  const headers = {
    "content-type": "application/json",
    "stripe-signature": signature,
  };

  // First delivery fulfils; a redelivery and a racing second checkout for
  // the same round both land on the schema's unique lines and answer 200.
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

  const rival = signedEvent({
    eventId: `evt_e2e_${randomUUID().replaceAll("-", "")}`,
    sessionId: `cs_e2e_${randomUUID().replaceAll("-", "")}`,
    metadata: { kind: "green_fee", round_id: paidRound, user_id: hostId },
  });
  const raced = await request.post("/api/billing/webhook", {
    headers: {
      "content-type": "application/json",
      "stripe-signature": rival.signature,
    },
    data: rival.payload,
  });
  expect(raced.status()).toBe(200);

  const rows = await greenFeeRows(paidRound);
  expect(rows).toHaveLength(1);
  expect(rows[0].user_id).toBe(hostId);
});

test("writes nothing for a tip or an unpaid session", async ({ request }) => {
  const tip = signedEvent({
    eventId: `evt_e2e_${randomUUID().replaceAll("-", "")}`,
    sessionId: "cs_tip",
    metadata: { kind: "tip" },
  });
  const unpaid = signedEvent({
    eventId: `evt_e2e_${randomUUID().replaceAll("-", "")}`,
    sessionId: "cs_unpaid",
    paymentStatus: "unpaid",
    metadata: { kind: "green_fee", round_id: quietRound, user_id: hostId },
  });

  for (const { payload, signature } of [tip, unpaid]) {
    const response = await request.post("/api/billing/webhook", {
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      data: payload,
    });
    expect(response.status()).toBe(200);
  }
  expect(await greenFeeRows(quietRound)).toEqual([]);
});
