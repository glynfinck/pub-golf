# Top-ups: what more caddy costs

Companion to `MONETIZATION.md`, which covers the green fee itself. This is
about what a host buys when the fee's allowance runs out, and — more usefully
— the measured costs the prices have to clear.

Nothing here has shipped. It is a design with real numbers behind it, written
down so the numbers survive.

## What the caddy actually costs

Measured from `caddy_turns` on preview, 11 August 2026 — twelve sessions, five
of which produced a card.

| | observed | note |
|---|---|---|
| **Re-design, tool loop ran** | **27.3p** | 10.4k output, 58.8k cache reads |
| Re-design, no loop | ~5.5p | took its first answer, ~1.7k output |
| **Tweak** | **~2p** (estimated) | never yet observed; ~12k cache read + ~1.5k output |

Three caveats that matter more than the averages:

**The loop is n=1.** One of five successful plans actually entered the tool
loop. That one observation is the entire basis for 27p, and it is the case
worth pricing against because it is the one that produces a good course.

**Recorded cost is the September price.** `MODEL_PRICES` lists Sonnet 5 at its
standard rate, deliberately — the introductory rate runs to 31 August 2026.
The real bill for that 27p run was about 12p on the day. Budgeting against the
intro rate would have built in a cliff; instead the numbers here are already
the post-cliff ones.

**Failed turns record zero and were not free.** Seven of twelve sessions failed
and wrote `cost_micropence = 0`, while the gateway billed for whatever streamed
before the failure. So the gateway's own balance reads higher than the ledger's
49.26p by an unmeasured amount. Fixing that — recording partial usage on the
`failed` path — is the prerequisite for treating any of this as precise.

## The ratio that drives the design

**Ten tweaks cost about as much as the re-design they are attached to.**

A tweak is ~2p, a re-design ~27p, so ten tweaks is 20p — very nearly doubling
what a pack costs to serve. Tweaks feel free and are not. This, not the price
per round, is what sets the margins on every pack below, and it is the number
to re-derive first once real tweaks have actually been observed.

## The ladder

Each pack grants **both** quotas. Selling tweaks on their own would mean making
a 2p action feel scarce, which is the failure the two-quota design exists to
avoid: a meter on "ask as often as you like" turns membership back into
credits. Tweaks arrive with rounds, or they do not arrive.

**The floor is the green fee's own rate.** £12 buys **four** re-designs, so a
round inside the fee costs £3, and no top-up may ever sell one for less. Volume
walks a host *down* to £3 and stops level with it.

The fee grants four rather than three for exactly this reason: at three it was
£4 a round and merely a bundle, level with the smallest top-up. At four it is a
discount — you are always better off having bought the fee. Get that backwards
and the bundle becomes the mug's option: buy the cheapest fee, top up in bulk,
and the thing meant to be the deal is the thing to avoid.

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

Because packs persist, volume is worth pricing again:

| Top-up | Grants | Price | Per round | vs the fee's £3 | Cost | Margin |
|---|---|---|---|---|---|---|
| Another round | 1 re-design + 10 tweaks | £4 | £4.00 | +33% | 47p | 82% |
| A few more | 3 re-designs + 30 tweaks | £11 | £3.67 | +22% | £1.41 | 84% |
| The full card | 8 re-designs + 80 tweaks | £24 | £3.00 | level | £3.76 | 82% |

Never below the fee's £3, so the bundle stays the best rate anyone can get.
Stripe's fixed 20p is why the floor is £4 and why there is no £1 rung.

The fee's own cost to serve rises with the fourth round: 4 × 27p + 60 × 2p =
**£2.28 of £12**, or 19%. Comfortable, and worth re-checking against the ledger
rather than against this table once real tweaks have actually been observed.

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
- a refunded pack removes its grants, and does not remove the fee's
- spends already made against a refunded pack do not push the balance negative
  (the reason grants and spends are separate tables)
- the day-lock: an expired grant stops counting, and its spends stop counting
  with it

The last three are the ones a single signed-delta ledger would have got wrong,
so they are the ones worth writing first.
