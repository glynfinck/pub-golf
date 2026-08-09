# Monetization — the green fee plan

Strategy record, August 2026. The full memo with screen mockups lives in the
committee artifact ("The Green Fee"); this file is the durable summary the
code can be checked against.

## Feasibility verdict

Taking money is a small build on this stack, because the architecture already
separates the only plausible payer from everyone else:

- **Hosts have stable Google identities** (`auth.uid()` survives card claim
  via `linkIdentity`), so entitlements key on the same uid everything else
  does. **Guests never cross the payment boundary** — joining stays code +
  first name, no account, no price ever rendered on a guest surface.
- **Email-free auth is not a blocker**: Stripe Checkout collects its own
  receipt email. No Resend, no emailed codes — the auth covenant in
  CLAUDE.md survives.
- **Premium round features ride the ruleset snapshot** through `readRuleset`,
  like mulligans and handicaps: entitlement is checked once at round
  creation, never mid-round, so webhook lag or a refund can never brick a
  live table.
- **The state is one additive table** (`entitlements`: user_id, kind,
  round_id nullable, provider event id for idempotency). RLS: users read own
  rows; only the webhook writes (service role). Remember the house gotcha —
  the new table needs the `service_role` grant or the db test tier goes
  dark. Prove the policy in `tests/db` the way seat rescue is proven.
- **Fulfil on the webhook, never the success redirect.** Verify the
  signature against the raw body in a route handler
  (`app/api/billing/webhook/route.ts`), idempotent on event id.
- Web/PWA only → no app-store 30% on digital goods. That question only
  opens if a native wrapper ever ships.

## Provider

**Stripe** (decided). Stripe Checkout hosted pages — native Apple Pay and
Google Pay, card data never touches the app, PCI stays at the
self-assessment tier. Setup: Checkout Sessions from a server action;
fulfilment on the `checkout.session.completed` webhook (never the success
redirect), verified against the raw body and idempotent on event id;
`stripe listen` forwarding webhooks to the local stack in dev. Hosted
checkout needs no Apple Pay domain registration — that is only for
payment elements embedded on our own pages.

Tax resolved itself: the account has **Managed Payments** enabled —
Stripe's merchant-of-record product — so Stripe is the seller of record
and registers and remits VAT/GST itself (`automatic_tax.liability:
stripe` on every checkout). The requirement it imposes: every product
carries an eligible digital-goods tax code; both are set to
`txcd_10103000` (SaaS, personal use). Managed Payments can also issue
refunds within 60 days to head off chargebacks, which pairs with the
small-print policy. No separate Stripe Tax setup is needed.

Fee floor: nothing on the tariff under ~£3, or fixed fees eat the payment.

### Live Stripe objects

Created via the Stripe MCP (live mode, account `acct_1U2ZUZRvKayBe2Nz`,
"Pub Golf"). Prices are **multi-currency** — one price per product with
`currency_options`, so Checkout presents the buyer's own currency — and
**tax-inclusive**: the sticker is the price. Code resolves prices by
`lookup_key`, never by hardcoded id.

| Product | lookup_key | GBP | USD | CAD |
| --- | --- | --- | --- | --- |
| The green fee (`prod_V2ewNtObRI3fq7`) | `green_fee` | £4 | $5 | C$7 |
| The honesty box (`prod_V2ewOnbYvJY3Ul`) | `honesty_box` | min £3 · preset £5 | min $4 · preset $7 | min C$5 · preset C$9 |

The honesty box is a customer-chooses-amount price
(`custom_unit_amount`), so it works from Checkout or a Payment Link
without the app dictating the tip — and it has a live Payment Link,
phase one's entire payment surface (tips grant nothing, so no webhook or
entitlements are needed to ship it):
`https://buy.stripe.com/9B628teB70SXf3rdVQ2Ji00`
(`plink_1U2aUpRvKayBe2NzttVJk5uj`). The season ticket is deliberately not
created yet — phase three earns it first. For local dev, mirror both
products in a sandbox under the same lookup keys so the code never
branches on environment.

## The covenant (product rules, public)

1. **Joining is free forever.** Guests are the growth loop.
2. **What's free stays free.** No clawbacks — themes,
   handicaps, mulligans, table size, saved courses are grandfathered for
   everyone. New money buys new things only.
3. **The host pays, never the table.** One buyer, at planning time.
4. **Two moments only**: round creation and the results afterglow. Money is
   mute in the lobby, on the card, during play, and on every guest surface.
5. **One honest tariff.** Round numbers, no countdowns, no fake discounts,
   no guilt declines, refunds on request ("rained off? money back"), never
   ads, never data.

## What we sell

- **The green fee** (core): ~£4, one-time, host pays, unlocks extras for one
  round — the league (multi-round standings), the printed pack (A4 card +
  trophy card), colours/crest on the recap, curated course packs. All *new*
  features; the free game is untouched.
- **The honesty box** (ships first): pay-what-you-feel tip (£3/£5/£10) on
  the results screen. Its product is the willingness-to-pay signal.
- **The season ticket** (later): ~£19/year, every green fee included plus
  the league archive. Offered *only* to hosts with 2+ paid green fees.
  Annual, not monthly. Cancel promise stated in the pitch.
- **The society game** (opportunistic): concierge branded events for
  corporates/stags, £49–99, manual until enquiries repeat.
- Rejected on principle: ads, data, charging joiners, clawbacks, sponsored
  placement (also constrained by Google Places terms).

## Rollout phases and gates

1. **Listen** — instrument the funnel (rounds created/joined/finished,
   recaps shared) and ship the honesty box behind a flag. Advance on a
   month of data; tips at ~2–5% of finished rounds = real demand.
2. **Sell the extras** — entitlements migration + webhook + unlock sheet +
   members' options group on the new-round form. Advance when attach ≥5%
   and refunds <2%.
3. **Reward the regulars** — season ticket, only if a repeat-buyer cohort
   exists. If it never appears, this phase never ships.

**Guardrails** (any of these regressing pauses rollout): join → seated
conversion, rounds per returning host, finish rate, recap shares per
finished round. The tell that monetization is hurting is upstream of
revenue.

## Voice

House copy rules apply: dry, in the golf fiction, no exclamation marks, no
emojis. Every price sentence answers *how much, for whom, how often* in one
breath ("Green fee · £4 — one round, the whole table"). Free is the first
line of the tariff page. Declines are plain ("Not this round"), never
guilt. Copy never assumes a time of day — rounds are played in daylight as
often as after dark, so no "tonight", no "today", no "evening" anywhere.
