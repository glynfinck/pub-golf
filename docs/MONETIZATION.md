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

| Product | lookup_key | GBP | USD | EUR | CAD | AUD |
| --- | --- | --- | --- | --- | --- | --- |
| The green fee (`prod_V2ewNtObRI3fq7`) | `green_fee` | £4 | $5 | €5 | C$7 | A$8 |
| The honesty box (`prod_V2ewOnbYvJY3Ul`) | `honesty_box` | min £3 · preset £5 | min $4 · preset $7 | min €4 · preset €6 | min C$5 · preset C$9 | min A$6 · preset A$10 |

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

## Integration state

The foundation is in: the `entitlements` table (`20260821000000` —
additive; webhook-only writes, member-readable so premium features render
for the whole table, idempotency schema-level), `lib/billing.ts` (pure,
unit-tested), `startGreenFeeCheckout` in `lib/actions/billing.ts`
(signed-in hosts only, never a guest; resolves the price by lookup key;
fulfilment never here), the webhook at `app/api/billing/webhook`
(signature-verified; 23505 answered 200), and the honesty box behind
`NEXT_PUBLIC_HONESTY_BOX_URL` — paste the Payment Link in and phase one
is on. `STRIPE_SECRET_KEY` empty = billing off entirely, the maps-key
pattern. `types/database.ts` was extended by hand for the new table —
regenerate from the local stack at the next schema change.

CI proves the loop with no Stripe anywhere in it:
`tests/db/rls-entitlements.test.ts` is the adversarial policy suite, and
`e2e/billing-webhook.spec.ts` posts events signed with Stripe's own
`generateTestHeaderString` (dummy secret, pure crypto, zero network) at
the real route and reads the row back out of Postgres. Real-sandbox
smoke tests stay out of the required gate on purpose: third-party
network is flake, and the gate fails flakes.

The sandbox tier (`npm run test:stripe`, `tests/sandbox/`) is the one
place tests talk to real Stripe — test mode only; suite and seeder both
refuse a live key. `scripts/stripe-seed.mjs` mirrors the tariff into any
sandbox idempotently, and the smoke suite verifies the account against
`lib/tariff.ts` (the seeder can't import TS, so this cross-check is what
catches drift) and opens, then expires, a real checkout session — the
API-shape failures the offline spec can't see, like the Managed Payments
tax-code rejection the live account once handed us. By decision it runs
**inside the `verify` gate** on every PR (seed + smoke, before the stack
comes up, off the `STRIPE_SANDBOX_SECRET_KEY` repo secret;
green-with-skips when the secret is absent, as on forks) — the one
accepted third-party dependency in the gate, four test-mode API calls.
`.github/workflows/stripe-sandbox.yml` remains for the Monday drift
check and for seeding a fresh sandbox by hand.

Phase two is in, shipped dark. The green fee is a **day pass on its buyer**,
so `startGreenFeeCheckout` takes no round and needs none to exist — it is
offered from the members' options group on the new-round form, and the
webhook mints one row with `round_id` null and `expires_at` 24 hours from
the *event's* timestamp (never from delivery, which Stripe retries). What a
round keeps is `members` in its own ruleset snapshot, stamped by
`startRound` at tee-off and guarded by `guard_round_members`
(`20260823000000`): admitted only on an UPDATE, only false→true, and only
while `holds_day_pass(rounds.host)` — a definer function, because the caddy
tees rounds off too and a round-less entitlement is visible to its buyer
alone. Covered stays covered: a pass that expires or is refunded mid-round
cannot change what a table already playing was teed off under, and
un-stamping raises 42501. A round is born uncovered — the INSERT half
refuses the flag outright, so posting your own ruleset at the create
endpoint buys nothing. Tee-off falls back to an unstamped update if the
guard refuses, because a green fee is allowed to buy nothing and never
allowed to stop a group getting started.
`tests/db/rls-day-pass.test.ts` is the adversarial suite.

The stamp is now a **receipt rather than a permission**. It admitted a
round to the league until the league went free; nothing reads it to decide
what a table may see. It is still written and still guarded, because a
flag that says "a fee was covering this" is forgeable the moment it is
not, and because a receipt started only once somebody thinks of a use for
it has a hole in the middle.

### Why the league is free

The league (`/league`) was the first extra and should not have been one. A
league is the game keeping score of itself: standings are what make the
second round mean more than the first, so charging for them priced the
sport rather than the service. The twenty-four-hour window made it sharper
— a table that played on Friday and again a fortnight later had two rounds
and nowhere to put them unless somebody paid twice, which is the one shape
of pricing that punishes the behaviour the product wants most.

So it is free, for everyone, across every finished round on the viewer's
card, ranked on the *average* to par rather than the total because a
league ranking on the total would punish turning up. Moving an extra off
the paid list is the one direction the covenant allows: "what's free stays
free" forbids the reverse and never this.

What the fee buys instead is **the caddy** — an evening's legwork done for
you in twenty seconds, which is a service rendered rather than a part of
the game withheld. It is the whole of `GREEN_FEE_EXTRAS` today; the
printed pack, the colours and the curated course packs join it the day
they ship, and until then this list does not mention them. With no
`STRIPE_SECRET_KEY` the group is not on the page at all.

Phase one's other half — the funnel — is in as `20260822000000`, and it
is deliberately the smallest thing that works: no events table, no
vendor, no second copy of the truth. Three of the four moments were
already facts in the schema and are counted where they lie (`created_at`
on a round, `joined_at` on a seat minus the host's own, and a new
derived `finished_at`); only the fourth leaves no trace, so a recap share
bumps `rounds.recap_shares` through `record_recap_share` — a definer
function, because guests share the card and guests cannot update a
round. Both columns are derived rather than submitted: `finished_at`
comes off the status transition, and the counter moves only for that
function, which announces itself with a transaction-local setting the way
seat rescue does. `house_funnel(since, until)` returns the five numbers
(the four moments plus green fees sold) and is granted to `service_role`
alone — how many rounds the house ran is the house's business. Tips have
no numerator here on purpose: the honesty box is a Payment Link, so
Stripe's own dashboard is where tips are counted, against
`rounds_finished` as the denominator.

## The caddy's quotas — the design, and the mistake it corrects

**Quotas count actions. Cost caps bound one action. They are not the same
mechanism and they must never be confused, because they fail differently.**

- A **quota refuses**. "You've used your three re-designs." That is a product
  fact, it belongs on screen, and it deserves a warm line and a door to what
  the host already has.
- A **circuit breaker** stops a runaway. It is set far above any honest plan,
  it logs loudly when it fires, and a host should never meet one. If somebody
  does, that is an incident to investigate rather than a tariff.

A third idea was tried and is wrong: a cost cap that **truncates** an action to
fit its share of the fee. It looks like generosity — never refuse, just hand
over what you have — and it is the opposite. A host who paid for a re-design
and received a four-turn card that was never route-checked has been quietly
given a lesser product, and cannot tell. This repo already states the rule
elsewhere: *no silent caps; silent truncation reads as "covered everything"
when it did not.*

**Work is bounded in turns, not in tokens.** `MAX_TOOL_TURNS` is an honest
bound — the caddy is told how many turns it has and is expected to finish
inside them — and cost follows from it. That is a decision about thoroughness,
which is ours to make, rather than a budget the host pays for in quality.

**And the variance is ours.** Some courses cost a tenth of what others do. A
fixed-price package absorbs that by construction; pricing it on the observed
mean plus headroom is the whole mechanism. Pushing the variance back onto the
host — yours was expensive, so yours is shorter — defeats the point of selling
a fixed price at all.

Every symptom the caddy produced in its first day of real use came from one
confusion: **the daily budget refused.** It is a cost cap wearing a quota's
clothes. That single mistake produced a "Covered" badge on a fee with nothing
left, a wall a paying host met with no warning, and a fee that sells three
courses delivering one — because the money ran out before the count did, and
the money was allowed to say no.

### The shape

| Layer | Unit | Fails by | Seen? |
|---|---|---|---|
| Re-designs | actions | refusing | yes — an abstract bar |
| Tweaks | actions, generously | refusing | no, unless approached |
| Work per action | turns | finishing | never |
| Runaway | cost, far above normal | breaking, loudly | never |
| Anti-script | turns per day | refusing | never, by a human |

**Two quotas, not one, because the costs differ by an order of magnitude.** A
re-design is a fresh Places gather, a forty-pub dossier cache write and a
tool loop; a tweak is a cached prefix and one short call. Sharing one
allowance meant two expensive plans ate the entire tweaking budget — so the
thing `lib/caddy/fair-use.ts` promises most loudly, *ask as often as you
like*, was being consumed by the thing next to it. Splitting them is not extra
machinery, it is the fix.

**Counting actions is safe because the work in an action is bounded** — a
fixed number of turns, each with a fixed token ceiling — so the worst case is
knowable in advance even though the typical case is far below it. Count the
actions and pounds never appear in the product at all. The daily budget stops
existing as a rule; what replaces it is a quota the host understands and a
breaker they never see.

**The two are not equally visible.** Re-designs are chunky, bought, and the
only number that helps at the point of sale. Tweaks are the membership
promise, and a meter on them converts membership back into credits — the
argument `fair-use.ts` already makes at length. Tweaks keep a backstop that no
real host should ever see; if one does, that is a bug report, not a tariff.

**The bar names no unit.** A fill that moves as the fee is consumed, three
qualitative states, no digits and no reset timer. The covenant's ban on
countdown clocks is about manufactured urgency, and a number ticking toward
zero on something already bought is exactly that.

**Time is the one limit that does bind, and it binds everything.** Credits
live inside the fee's day and lock at its end, spent or not — an unspent credit
that outlived its pass would be an indefinite one, which is the whole reason
the day boundary exists. Tweaks stop at the same moment: a conversation is
resumable for twelve hours, so without that check a session opened late at
night could go on producing entirely new cards after the pass had run out.
Expiry is a fair limit in a way truncation is not, because it is knowable in
advance, it is the same for everybody, and it takes nothing away from work
already done — every course a fee planned stays the host's for good.

**The promise is a floor, not a ceiling.** "A green fee plans you at least
three courses." A floor can be kept and then beaten — a host whose courses came
cheap gets another as generosity. A ceiling is a thing to defend.

### Sequencing

1. **The split** — quota kinds on `caddy_credits`, the daily budget demoted
   from refusal to truncation, fair use pushed down to anti-script only, the
   usage UI redone. Complete and shippable on its own; the green fee grants the
   package and nothing new is sold.
2. **The wallet** — what a host holds, on their profile. Reads the same ledger.
**A pricing note that outranks all of the above.** `CADDY_BUDGET_SHARE` is 12%
of the fee — 48p — and it was sized when a plan was a single call costing about
11p. A looped plan costs several times that, which is why a fee that sells
three courses could deliver one. The share has to be re-based on what a looped
plan actually costs before any of this is sold, and `caddy_turns.cost_micropence`
is already recording exactly that. Re-base from the ledger, not from an
estimate: the estimates in this file's history have been wrong twice.

3. **Top-ups** — new Stripe SKUs, checkout paths, webhook fulfilment for new
   entitlement kinds. Deliberately last: it is the most external surface and
   the least useful until somebody has actually run out, and by then
   `caddy_credits` says *which* quota they exhausted. Pricing a top-up from
   that beats pricing it from a guess. The entitlement model already supports
   several live fees, so this needs no rework of what comes before it.

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

- **The green fee** (core): ~£4, one-time, host pays — and it is a **day
  pass**, which is what a green fee means in real golf: 24 hours of the
  caddy planning courses for you, and of whatever else joins the list —
  the printed pack (A4 card + trophy card), colours/crest on the recap,
  curated course packs. All *new* features; the free game is untouched,
  and the league left this list on purpose (see "Why the league is free"). The day window is the
  mistake-forgiveness design: a misconfigured round can be abandoned and
  remade freely inside the window, so a fee is never burned by a setup
  error and no refund email ever needs writing. Once a round tees off
  covered, it stays covered forever — the pass expires
  (`entitlements.expires_at`), granted rounds don't, so a slow crawl
  crossing the 24-hour line and a refunded pass alike can never brick a
  live round. Several tables on one day-pass is accepted generosity,
  capped at £4; the day boundary is the protection — yesterday's pass
  doesn't cover a new day, and the members' group says so plainly
  ("extras for a new day take a new fee"), never with a lock icon.
  Enforcement follows house doctrine when phase two builds it: the
  members flag stamps into the ruleset snapshot at tee-off (checked once,
  never mid-round), guarded by a BEFORE UPDATE trigger that admits it
  only while the host holds a live pass — the same OLD-vs-NEW pattern as
  roles and handicaps. The pass is always visible while it runs: an
  active-pass card in the Clubhouse and a "Covered — 16h left" line in
  the members' options group, on the sanctioned `use-countdown` pattern.
  That stays the right side of the covenant's "no countdown timers" rule,
  which bans sales clocks — fake urgency before purchase — not a fact
  about something already owned, shown only after buying.
  (Alternatives considered and set aside:
  consume-on-completion forgives a 17-of-18-holes abandon; a movable
  credit that attaches at tee-off is strictest per-round but needs three
  user-visible states and the most rules for the least warmth.)
- **The honesty box** (ships first): pay-what-you-feel tip (£3/£5/£10) on
  the results screen. Its product is the willingness-to-pay signal.
- **The season ticket** (later): ~£19/year, every green fee included.
  Offered *only* to hosts with 2+ paid green fees.
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
