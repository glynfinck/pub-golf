# Caddy: where this is up to

Handoff for picking the branch up in a fresh session. Branch:
`claude/pub-golf-caddy-spec-ydipz4`. Everything below is committed and pushed;
the working tree is clean.

```
git fetch origin claude/pub-golf-caddy-spec-ydipz4
git checkout claude/pub-golf-caddy-spec-ydipz4
```

## The one-line state

**The caddy is not a working product yet.** The plumbing is complete and
nothing is built-but-unreachable, but no plan has run end to end since the
fixes. The next useful action is one real plan on preview, not more code.

## The open bug, and the best lead

A plan runs, the model calls tools, **nothing lands on the drafting table**,
and the run ends with a refusal.

Two things were fixed tonight that were producing that symptom for unrelated
reasons, so re-test before assuming the tool problem is real:

1. **The budget was refusing paid work.** A 12%-of-fee ceiling stopped the
   third re-design on a fee that grants four, with the "full shift" sentence.
   Removed from `runTurn` *and* from `guard_caddy_fair_use` (migration
   `20260904000000`, already applied to preview). If the last thing seen was
   that message, it may have been this and not the tools at all.
2. **The system prompt ordered a search loop.** It said "try_route before you
   hand anything over, and again after you change it", so the model searched
   instead of drafting. It now leads with **PUT A ROUTE ON THE TABLE FIRST**.

If holes still do not land after those, the thing to instrument is
`applyDraftTool` / `dispatchTool` in `lib/caddy/session.ts` and `tools.ts` —
specifically whether `set_hole` is being *refused* (an unknown candidate id
comes back as a readable sentence, which the model may be quietly absorbing
turn after turn) rather than failing loudly. A refusal loop would look exactly
like this: tools called, nothing saved, no error.

## What the ledger says

Read it, don't guess. This is the only source of truth for whether any of it
works:

```sql
select kind, failed, output_tokens, cache_read_tokens,
       round(cost_micropence/1e6,2) as pence, created_at
  from caddy_turns order by created_at desc limit 5;
```

`cache_read_tokens` is the number that matters. 160k on a timeout, 71k on the
one success — both with the model searching. If the route graph is being used
it should fall toward a single dossier read. That number decides whether the
two-stage rewrite in `CADDY-STAGES.md` is needed or optional.

## Done and verified

- **Tariff** — green fee £12 (was £4), all five currencies. Stripe sandbox
  repriced; `scripts/stripe-seed.mjs` can now reprice rather than skipping an
  existing lookup key. **Live Stripe is still £4 and has no top-ups.**
- **Ledger** — `caddy_grants` / `caddy_spends`, grants expire only if the
  purchase does. Refund cascades (`20260903000000`). Fee grants 4 re-designs
  and 60 tweaks.
- **Top-ups** — £5 for 1 round, £12 for 3, durable. Stripe sandbox has both;
  webhook fulfils them; sold from the spent sheet and nowhere else.
- **`liveFee` foreign-key bug** — was writing a grant id into
  `caddy_sessions.entitlement_id`. Broke every plan. Fixed.
- Map re-frames on a new patch; a saved course can resume its session; the
  spent-allowance copy no longer claims a fee plans one course.

## Built, wired, unproven

Everything here is unit-tested and has never completed a real run:

- **`lib/caddy/route-graph.ts`** — precomputed routes + k-nearest neighbours,
  folded into the cached prefix by `patchBlock`.
- **Fallback board** — a loop that drafts nothing hands over the best
  precomputed route with default dressing rather than failing.
- **Card recovery** — every failure path asks whether a card landed before
  apologising. The card is written before streaming, so a dead connection is
  recoverable.
- **Turn bound** — 90s per call, loop budget 150s, worst case 240s inside a
  300s ceiling. This is what makes failure *observable*; before it, a killed
  function left no row at all.
- **Live route on the map** while planning.

## Designed, not built

- `docs/CADDY-STAGES.md` — replace the open loop with two bounded calls
  (choose a walk, then dress it). Step one of its ordering is already done.
- `docs/CADDY-ROUTE-GRAPH.md` (last section) — ten routes each winning a
  different objective, including drink breadth from the Places facts, so the
  "never put a drink on a hole the pub cannot pour" rule is enforced by the
  router rather than by the dressing.
- `docs/CADDY-TOPUPS.md` — the cost evidence and pricing reasoning.
  `docs/caddy-cost-evidence-20260811.json` is the raw data behind it.

## Not run at all

- `npm run test:db` and the sandbox smoke tests — both need a local stack /
  Stripe key. Several tests written tonight cover bugs that only surfaced
  against a real database, so these are worth running early.
- `npm run test:e2e`.

## Running it locally

The whole caddy runs against a local stack; nothing about it needs preview.

```bash
supabase start                 # ports 54330-54334, offset from `home`
supabase db reset              # applies every migration in order
npm run dev -- --port 3105     # 3000 is usually held by Docker
```

`.env.local` needs, at minimum:

```
NEXT_PUBLIC_SUPABASE_URL=          # supabase start prints it
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # needed by the db and e2e tiers
GOOGLE_PLACES_API_KEY=             # server-side; separate from the browser key
AI_GATEWAY_API_KEY=                # or ANTHROPIC_API_KEY — either satisfies caddyEnabled
STRIPE_SECRET_KEY=sk_test_...      # optional; without it the caddy group is absent
```

Two gates worth knowing before wondering why the group will not appear.
`caddyReady` (`lib/caddy/readiness.ts`) needs a model credential, a Places key,
a non-anonymous sign-in, and either billing on or a live pass. When it is
false and `showCaddyDiagnostics` is on, `/courses/new` renders `CaddyGates`
naming the exact variable that is missing — read that rather than guessing,
which cost hours on preview.

**Pointing the caddy at a local or cheaper model.** `CADDY_MODEL` overrides the
model id, and `lib/caddy/credentials.ts` decides the door: an
`AI_GATEWAY_API_KEY` sends everything to `https://ai-gateway.vercel.sh` with
the provider on the id (`anthropic/claude-sonnet-5`), while an
`ANTHROPIC_API_KEY` goes direct with a bare id. Anything speaking the Anthropic
Messages API can stand in — set `ANTHROPIC_API_KEY` to whatever the local
server wants and point the client's `baseURL` at it. **`MODEL_PRICES` in
`lib/caddy/budget.ts` must learn any new model id**, or `caddy_cost_micropence`
prices it at zero and the ledger silently stops being evidence; there is a unit
test asserting an unknown id is not free.

**Granting yourself a fee without paying.** The webhook is the only thing that
mints entitlements, so seed one directly:

```sql
insert into entitlements (user_id, kind, stripe_event_id, expires_at)
values ('<your uid>', 'green_fee', 'evt_local_' || gen_random_uuid(),
        now() + interval '24 hours');
```

`grant_caddy_package` fires on insert and mints 4 re-designs and 60 tweaks.
Swap the kind for `caddy_topup_3` with a null expiry to exercise a durable
top-up. Check either with
`select caddy_balance('<uid>','redesign');`.

## Deployment state

- **preview** — all migrations applied and verified through `20260904000000`.
  The tester's data was reset: fresh green fee, no courses, no rounds.
- **main / production** — untouched. Has no caddy tables at all; merging would
  be *launching* the feature. Don't, until a plan lands — and note the £12 fee
  is coupled to it, since without a working caddy it is a 3× rise for what
  people already get.
