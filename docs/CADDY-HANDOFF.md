# Caddy: where this is up to

Handoff for picking the branch up in a fresh session. Branch:
`claude/pub-golf-caddy-spec-ydipz4`. Everything below is committed and pushed;
the working tree is clean.

```
git fetch origin claude/pub-golf-caddy-spec-ydipz4
git checkout claude/pub-golf-caddy-spec-ydipz4
```

## The one-line state

**The caddy plans real courses end to end on preview**, and has done for a
while. What has been moving since is *route quality* — where the walk goes and
whether it doubles back — and that argument is now settled in unit tests rather
than by planning another round and looking at the map. The last piece of it,
the curator tools, has not yet been exercised by a live model.

The next useful action is one real plan on preview to see the caddy use
`plan_routes` and `exclude_pubs`, and to price a turn that does.

## Fixed, and worth knowing they were bugs

Every one of these produced a symptom that looked like something else, so they
are recorded rather than deleted:

1. **`liveFee` wrote a grant id into `caddy_sessions.entitlement_id`** (an FK to
   `entitlements`). Broke *every* plan with "The caddy isn't on duty here",
   which reads exactly like a missing key. Three wrong hypotheses were chased
   about the environment before the row was inserted by hand and the FK spoke.
2. **`entitlements_kind_check` allowed only `green_fee` and `season_ticket`**,
   so a top-up could not be inserted at all (23514). Found the same way.
3. **The budget was refusing paid work.** A 12%-of-fee ceiling stopped the third
   re-design on a fee that grants four. Gone from `runTurn` *and* from
   `guard_caddy_fair_use` (`20260904000000`). The runaway *breaker* that
   replaced it is deliberately far above any honest plan.
4. **The system prompt ordered a search loop** — "try_route before you hand
   anything over, and again after you change it" — so the model searched
   instead of drafting. It now leads with **PUT A ROUTE ON THE TABLE FIRST**.
5. **`includedTypes` rather than `includedPrimaryTypes`** in the Places query.
   `includedTypes` matches any type a place carries, so a nightclub and a
   restaurant reached a real card. The primary type is what a place mostly *is*.
6. **The axis is a line, not a direction.** A round asked to finish in Covent
   Garden walked Marylebone westwards. `aimFrom`/`aimTo` fixed it and
   `tests/unit/caddy-real-patches.test.ts` holds it, at real coordinates.

## What the ledger says

Read it, don't guess. This is the only source of truth for whether any of it
works:

```sql
select kind, failed, output_tokens, cache_read_tokens,
       round(cost_micropence/1e6,2) as pence, created_at
  from caddy_turns order by created_at desc limit 5;
```

`cache_read_tokens` is the number that matters: it is the model re-reading the
dossier, which is the signature of *searching* rather than thinking. The trend
across the branch, and the reason the route graph exists:

| | cache read | cost |
|---|---|---|
| Looped, searching (timed out) | 160,105 | 29.20p, no card |
| Looped, searching (landed) | 58,800 | 27.34p |
| Routes in the prefix | ~22,000 | ~23p |
| Routes in the prefix, single call | 0 | ~16p |

A first real tweak measured **6.59p** — 3× the 2p the tariff assumed, which
makes 60 tweaks the largest line on the bill. `docs/CADDY-TOPUPS.md` still
reasons from the older, dearer plan figures and should be re-derived from these.

Because the plan is now one call, `MAX_TOOL_TURNS` can come down as a
consequence rather than as a guess. It has not been cut yet.

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

## The routing, and why it is where it is

The division of labour, which is the one idea worth carrying into any change
here: **the algorithm plans the walk and the model curates it.** Every routing
failure on this branch was a language model doing search work that arithmetic
does in microseconds.

- **`lib/caddy/route-graph.ts`** — the distance matrix, greedy seeds, 2-opt and
  swap-in, and `ROUTE_OBJECTIVES`: ten routes, each *winning a different
  objective*, so the caddy chooses between different nights rather than between
  four attempts at the shortest one. Drink breadth is one of them, which is how
  "never put a drink on a hole the pub cannot pour" became geometry rather than
  a rule the dressing had to remember.
- **`bestForwardWalk`** — an exact DP over increasing subsequences along the
  patch's principal axis. Doubling back is not a scoring problem once the walk
  can only go one way.
- **`detour`** — walk ÷ straight-line progress. The number that *sees*
  backtracking, which total distance cannot.
- **The curator's tools** — `plan_routes` (a fresh menu, free and instant),
  `exclude_pubs` (a pub ruled out with a reason, remembered), `keep_draft` /
  `restore_draft`. This is what a caddy that dislikes the whole menu does
  instead of planning a route one stop at a time.

**Proved without a model.** `caddy-pathfinding.test.ts` runs six shapes × five
seeds through a seeded LCG; `caddy-real-patches.test.ts` is the actual bad cards
at their actual coordinates. Anything about where a walk goes belongs there —
testing it by planning another round costs a re-design and produces one data
point.

`docs/CADDY-ROUTE-GRAPH.md` is the design and, at the bottom, the audit of what
landed against it.

## Built, wired, not yet seen live

- **The curator's tools** — declared, dispatched, unit-tested; no live model has
  called one yet.
- **Fallback board** — a loop that drafts nothing hands over the best
  precomputed route with default dressing rather than failing.
- **Card recovery** — every failure path asks whether a card landed before
  apologising. The card is written before streaming, so a dead connection is
  recoverable.
- **Turn bound** — 90s per call, loop budget 150s, worst case 240s inside a
  300s ceiling. This is what makes failure *observable*; before it, a killed
  function left no row at all.

## Designed, not built

- `docs/CADDY-STAGES.md` — replace the open loop with two bounded calls
  (choose a walk, then dress it). Largely overtaken: the plan is already one
  call, so this is now an optimisation rather than a rescue.
- **Corridor queries** — "what is near this *walk*", distance to the polyline
  rather than to a node. `search_pubs` is the blunt instrument standing in for
  it. (`CORRIDOR_RADIUS_M` in `places.ts` is a different thing wearing a similar
  name: it aims the *gather* between two named areas.)
- `docs/CADDY-TOPUPS.md` — the cost evidence and pricing reasoning.
  `docs/caddy-cost-evidence-20260811.json` is the raw data behind it. **Its
  arithmetic predates the cheap plan**; see the ledger table above.

## Not run at all

The unit tier is green (`npm test`, 761 tests) and has been the whole way. The
rest of the pyramid has never run on this branch, because the session it was
built in had no local stack and no Stripe key:

- **`npm run test:db`** — the highest-value gap by some distance. The two worst
  bugs on this branch (the `entitlement_id` FK, the `kind` check constraint)
  were both invisible to types and to unit tests, and both would have been
  caught here. Several tests written for them have never executed.
- **`tests/sandbox/stripe-smoke.test.ts`** — needs a Stripe key.
- **`npm run test:stress`**, **`npm run test:e2e`**.
- **`supabase gen types typescript --local > types/database.ts`** — overdue.
  `types/database.ts` has been hand-edited repeatedly to keep pace with the
  caddy migrations, which is exactly the drift the generator exists to prevent.

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

- **preview** — every migration on this branch is applied, and the *effects*
  were verified directly rather than inferred from the migration list:
  `caddy_grant_size('redesign')` is 4, `entitlements_kind_check` carries all
  four kinds, `caddy_grants_entitlement_id_fkey` is `on delete cascade`, and
  `guard_caddy_fair_use` no longer mentions a budget. The tester's data was
  reset: fresh green fee, no courses, no rounds.
- **main / production** — untouched. Has no caddy tables at all; merging would
  be *launching* the feature. Don't, until a plan lands — and note the £12 fee
  is coupled to it, since without a working caddy it is a 3× rise for what
  people already get.

### Preview's migration list will not match the filenames — this is expected

The last four caddy migrations were applied to preview *by hand* while they
were being debugged, so preview recorded them under the timestamps they were
run at rather than the versions the files carry:

| File on this branch | Recorded on preview |
|---|---|
| `20260901000000_caddy_fourth_round` | `20260811185029_caddy_fourth_round` |
| `20260902000000_caddy_topups` | `20260811185114` + `20260811185214_caddy_topups_kind_check` |
| `20260903000000_caddy_refund_cascade` | `20260811185520_caddy_refund_cascade` |
| `20260904000000_drop_caddy_budget` | `20260811202836_drop_caddy_budget` |

**Do not renumber the files to match.** Supabase's GitHub integration tracks
migrations by version, so on the next push to `preview` it will see four
versions it has no record of and run them again — which is fine, because all
four are idempotent by construction: `create or replace` on functions,
`drop constraint if exists` before restating each constraint whole, and two
bounded statements (`amount = 3 → 4`, `delete … where entitlement_id is null`)
that now match zero rows. Verified against preview: both are already zero.

The kind-check fix has no file of its own because it was folded back into
`20260902000000_caddy_topups.sql` where it belongs. Preview's extra row is a
record of the hand-run, not a schema change the repo is missing.

The lesson underneath this: `list_migrations` on a hosted project tells you
what was *recorded*, not what is *true*. Check the schema.
