# Top-ups: what more caddy costs

Companion to `MONETIZATION.md`, which covers the green fee itself. This is
about what a host buys when the fee's allowance runs out, and — more usefully
— the measured costs the prices have to clear.

**All three rungs have shipped**, and the numbers below have been re-measured
against real traffic rather than the single observation this document was
first written from. Where an old figure is superseded it is named, because the
reasoning downstream of it is still on this page.

## What the caddy actually costs

Measured from `caddy_turns` on preview, 12 August 2026.

| | observed | note |
|---|---|---|
| **Plan** (the agentic loop) | **21.4p** | 19.8p–22.2p across three runs; ~36k cache reads each |
| **Roll** | **6.4p** | the patch is read back out of cache rather than bought again |
| **Tweak** | **5.2p** | previously *estimated* at ~2p, which was low by 2.5× |

The first draft of this page priced against a single 27.3p observation and an
estimated 2p tweak. Both moved: the plan came down as the loop settled, and
the tweak went up because a tweak re-reads the whole board. The direction that
matters is the second — tweaks are the quota granted sixty at a time.

Two caveats still stand:

**Recorded cost is the September price.** `MODEL_PRICES` lists Sonnet 5 at its
standard rate, deliberately — the introductory rate runs to 31 August 2026. The
real bill on the day is lower. Budgeting against the intro rate would have
built in a cliff; these numbers are already the post-cliff ones.

**Failed turns record zero and were not free.** A failed turn writes
`cost_micropence = 0` while the gateway bills for whatever streamed before the
failure, so the gateway's balance reads higher than the ledger's by an
unmeasured amount. Recording partial usage on the `failed` path is the
prerequisite for treating any of this as precise.

## What a fee can cost at worst

One plan, four re-designs and sixty tweaks — every credit a green fee grants,
all of them spent:

    21.4 + (4 × 6.4) + (60 × 5.2) = 359p, call it £3.92 with the failures

Against £12 taken that is a **67% margin at the absolute worst case**, and the
ordinary night — one plan, a roll or two, a handful of tweaks — is under 50p.
The sixty tweaks are 88% of that worst case, which is the thing to watch: they
are the quota granted most freely and the one whose unit cost moved most
between the two measurements on this page.

## The ladder

Each pack grants **both** quotas. Selling tweaks on their own would mean making
a 5p action feel scarce, which is the failure the two-quota design exists to
avoid: a meter on "ask as often as you like" turns membership back into
credits. Tweaks arrive with rounds, or they do not arrive.

**The floor is the green fee's own rate.** £12 buys **five** whole cards — the
course credit plus four re-designs — so a card inside the fee costs £2.40, and
no top-up may ever sell one for less. Volume walks a host *down* towards that
and stops well clear of it.

The shipped ladder, and it is deliberately monotone:

| rung | price | cards | per card |
|---|---|---|---|
| `caddy_topup_1` | £5 | 1 | £5.00 |
| `caddy_topup_course` | £9 | 2 (one of them a course to keep) | £4.50 |
| `caddy_topup_3` | £12 | 3 | £4.00 |
| *green fee* | *£12* | *5, and the round itself* | *£2.40* |

`caddy_topup_course` was £8 for one release, which put it level with the
three-pack at £4.00 a card *and* threw in a kept-course slot — so the dearer
rung was the better buy and "cheaper with volume" was untrue in the middle of
its own ladder. £9 fixes it. Both properties — monotone rungs, and every rung
dearer per card than the fee — have a unit test.

The fee grants five rather than three for exactly this reason: at three it was
£4 a card and merely a bundle, level with the largest top-up. Get that
backwards and the bundle becomes the mug's option: buy the cheapest fee, top up
in bulk, and the thing meant to be the deal is the thing to avoid.

**Granted expires. Bought does not.** This is the rule the earlier drafts got
wrong, and it needs stating before the prices.

The trap it avoids: if a top-up expired with the pass it was bought against,
an eight-round pack bought at nine in the evening would be gone by one in the
morning. Nobody should buy that, and anyone who did would be right to feel had.
A discount that only pays off if you spend it in four hours is not a discount —
which is why big packs stopped making sense the moment expiry was applied to
them evenly.

It is also not what comparable products do, and the convergence is striking.
Midjourney's subscription fast-hours reset monthly; *purchased* fast-hours roll
over. Tinder's subscription Super Likes refresh and lapse; bought packs sit in
the account indefinitely. OpenAI prepaid credits run a year. Vercel's own AI
Gateway credits, per the purchase flow, run a year. The one category that sold
a fast-expiring paid balance — cashless festival wristbands — took a public
kicking for it and now refunds the remainder.

The reason specific to *this* product is the one that settles it: **cost is
incurred entirely at redemption.** An unredeemed round costs nothing to hold on
somebody's account. Expiring a purchased top-up therefore earns breakage
revenue and nothing else, and breakage is precisely what makes a brand feel
mean. It would also sit badly beside the covenant's *what's free stays free, no
clawbacks* — what is paid for should stay paid for at least as firmly.

So:

- **The fee's grant expires with the pass.** The fee is sold as a day, it is a
  day, and that is honest. Unchanged.
- **Top-up grants do not.** They carry to the next night. A year is the
  outer bound if one is ever wanted, matching the norm above and keeping the
  ledger's accounting finite; nothing needs it sooner.

Spend order already handles the mix correctly and needs no change:
`caddy_next_grant` takes the grant nearest expiry first, so tonight's fee burns
before a durable top-up does. A host who buys a pack and then buys a fee gets
the fee's rounds first, which is what they would choose themselves.

Because packs persist, volume is worth pricing — but only just. Two rungs, not
three:

| Top-up | Grants | Price | Per round | vs the fee's £3 | Cost | Margin |
|---|---|---|---|---|---|---|
| **Another round** | 1 re-design + 10 tweaks | **£5** | £5.00 | +67% | 47p | 85% |
| **A few more rounds** | 3 re-designs + 30 tweaks | **£12** | £4.00 | +33% | £1.41 | 85% |

Priced well clear of the fee's rate rather than just above it. An earlier draft
opened at £4 — a third over the fee's £3 — and that is too close: a top-up
barely dearer than the bundle makes the bundle look like a rounding error
rather than the deal. At £5 and £4 a round the fee is obviously the thing to
buy, and a top-up reads as the convenience it is.

£12 for the three-pack is deliberately the same sticker as a whole green fee.
At one price a host sees three rounds they keep for ever against four that
expire tonight, and the comparison does the selling without a word of copy.

Stripe's fixed 20p is why there is no £1 rung and why the floor sits where it
does. Margins hold at 85% on both.

A third rung was drawn and then cut. Eight rounds at £24 priced a spreadsheet
row rather than a customer: demand here is lopsided — most hosts need no
top-up at all, some need one, and essentially nobody needs eight in a life,
let alone a night. Asking a £12 customer to consider a £24 purchase makes the
whole tariff read as a pricing page, which is the one thing the covenant's
"one honest tariff" is against. If real demand ever shows a tail, the rung can
come back; inventing it first is how a bar board turns into a menu.

## Where money is allowed to speak

The harder half of this design, and the half a price table hides.

The covenant permits money at two moments: round creation and the results
afterglow. No guilt declines, no countdown clocks. A "you have run out of
rounds" upsell is a **third** moment, and waving that through would make the
covenant decoration.

It survives on a distinction worth stating precisely: the covenant forbids
money **interrupting**, not money **answering**. A host who has just asked for
a fifth course and been refused is not being sold at — they are being told what
their options are, and concealing the option at exactly the moment it is
relevant would be the worse failure. Refusal without a way forward is not
restraint, it is a wall.

So the rule, and it is the load-bearing part of this section:

- The offer appears **only in response to an action the host took** — a plan
  that could not run. Never on arrival, never on the drafting table, never
  beside a course that is working fine.
- It appears **once**, in the refusal itself. It is not a banner that persists,
  and it does not return on the next screen.
- The free path is **named first**. `CADDY_CREDITS_SPENT` already does this —
  every course is yours to keep and change, and plotting one by hand is free as
  always — and the top-up is the quieter second line, not the headline.
- No count in the refusal, no scarcity, no clock. The number lives on the
  drafting table *before* it is spent, where it is useful; repeating it inside
  a refusal is how a tariff turns into a scolding.

The balance a host sees does **not** distinguish a fee's rounds from a bought
one. `CaddyUsage` reads a single total, because "4 courses left" is the fact
and which grant it will come off is bookkeeping. That also keeps the copy
honest as the mix changes — "left on this fee" stops being true the moment a
durable pack exists behind it, so that phrasing goes.

## How it lands in the schema

Nothing new is needed. This is what the grants/spends split was for.

A top-up is an `entitlements` row with a new `kind`; `grant_caddy_package`
already mints `caddy_grants` on insert, keyed by quota. Two things to settle
when it is built:

**Expiry.** Settled above and worth repeating here because it is the thing a
schema makes easy to get wrong: the fee's grants carry the pass's `expires_at`,
top-up grants carry none. Same table, same shape, one nullable column doing the
distinguishing — `caddy_balance` already treats a null expiry as live, so this
needs no new logic, only the discipline not to stamp one.

**Order of spend.** `caddy_next_grant` currently takes the grant nearest
expiry first, which is right for stacked fees and stays right here: spend the
thing that is about to disappear before the thing that is not.

## The sandbox tests this needs

`tests/sandbox/stripe-smoke.test.ts` asserts the green fee against `TARIFF`,
every currency, and a live Checkout `amount_total`. Top-ups want the same
treatment plus the combinations, because the interesting failures are all in
the seams:

- every pack's price and currency ladder matches `TARIFF`, as the fee does
- a pack purchase mints grants of **both** quotas, in the right amounts
- two packs bought together stack rather than replacing each other
- a pack on top of a live green fee adds to the balance, and the fee's own
  grant is still spent first
- a pack bought with **no** green fee at all still grants — a top-up is a
  purchase, not an add-on to a pass
- a refunded pack removes its grants, and does not remove the fee's — **done**,
  see the section below
- spends already made against a refunded pack do not push the balance negative
  (the reason grants and spends are separate tables)
- the day-lock: an expired grant stops counting, and its spends stop counting
  with it

The last three are the ones a single signed-delta ledger would have got wrong,
so they are the ones worth writing first.

## Settled: a refunded purchase takes its rounds with it

`caddy_grants.entitlement_id` was `on delete set null`, which orphaned a grant
rather than removing it. Survivable while every grant carried a fee's expiry —
an orphan died on its own clock inside the day. Durable top-ups ended that: a
grant with no expiry, orphaned, is immortal. Refund the purchase, keep the
rounds for ever. It was quietly wrong for the fee too, where a refund inside
the window left the rounds spendable until the clock ran out.

`on delete cascade` (migration `20260903000000`), and the accounting objection
to it does not survive inspection. The worry was losing the record of what a
purchase produced — but that record is not in this table. `caddy_turns` holds
the model, the tokens and the recomputed cost, and it references the *session*,
not the grant, so it is untouched. What cascades is `caddy_spends`, the counter
that decides a balance; once the purchase is refunded there is no balance for
it to decide. Grant and spends go together, the balance returns to what it
would have been, and nothing can go negative.

Covered by four db tests: both kinds pass the entitlements gate (the regression
for the CHECK-constraint bug), a refunded top-up leaves no grant behind,
refunding one purchase leaves another alone, and a refund after spending never
drives the balance below zero.
