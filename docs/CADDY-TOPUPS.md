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

| Pack | Grants | Price | Per round | Cost to serve | Margin after Stripe |
|---|---|---|---|---|---|
| Another round | 1 re-design + 10 tweaks | £2 | £2.00 | 47p | 65% |
| A few more | 4 re-designs + 40 tweaks | £6 | £1.50 | £1.88 | 64% |
| The full card | 10 re-designs + 100 tweaks | £12 | £1.20 | £4.70 | 58% |

Stripe takes roughly 1.5% + 20p on a UK card, which is why there is no £1 rung:
a fixed 20p is a fifth of a pound, and a pack that loses 20% at the door is a
pack priced for Stripe rather than for the host.

### The open question

At the top rung, £12 of top-up buys ten rounds where £12 of green fee buys
three. Bulk beating the bundle is ordinary retail, but it does mean the fee
stops being the best *caddy* value and becomes the best *night* value — it is
the round, the league and the recap as well.

If the fee should always win per-round, the top rung is **6 rounds at £12**,
not 10. That is a positioning call, not an arithmetic one.

## How it lands in the schema

Nothing new is needed. This is what the grants/spends split was for.

A top-up is an `entitlements` row with a new `kind`; `grant_caddy_package`
already mints `caddy_grants` on insert, keyed by quota. Two things to settle
when it is built:

**Expiry.** The green fee's grants expire with the pass, because the fee is a
day. A top-up bought at 11pm with a 1am expiry is a purchase that evaporates.
Either top-up grants outlive the pass, or the pass extends — and "what's free
stays free, no clawbacks" argues that a thing bought outright should not
vanish on someone else's clock.

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
