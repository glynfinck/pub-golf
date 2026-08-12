# The Caddy — Design Document

*Branch `claude/pub-golf-caddy-spec-ydipz4`, verified against the tree at `ada7852`. The unit tier is green (44 files, 798 tests, run for this document). The db, stress, e2e and sandbox tiers were **not** run — no local stack in this session — so every claim marked "asserted, unrun" is read off the test source, not observed.*

---

## 1. What the caddy is

The caddy is the green fee's headline extra: a host names a patch of town — or two, if the night is going somewhere — says how many holes and how far apart they want them, and about twenty seconds later a routed course arrives on the drafting table as a draft they own. Every pub on it is a real door: the caddy picks from what Google actually returned for that patch, orders the walk with arithmetic rather than judgement, and dresses each hole with a drink, a par, a hazard and the odd local rule. It arrives in the same builder a hand-plotted course arrives in, with the same edit controls, because the caddy's job is to save a host an evening of legwork, not to hand down a card. The manual builder underneath it is free and untouched, and stays that way. Nothing on screen calls it AI.

---

## 2. The pricing model

### What is sold

Four SKUs, all one-time payments through Stripe Checkout, all tax-inclusive, all priced from one board (`lib/tariff.ts:TARIFF`). One string is simultaneously the Stripe lookup key, the checkout `metadata.kind`, the `entitlements.kind` and the `caddy_grants.reason` (`lib/billing.ts:GREEN_FEE_LOOKUP_KEY`, `CADDY_TOPUP_LOOKUP_KEYS`).

| SKU | GBP | Grants | Expiry |
|---|---|---|---|
| `green_fee` | £12 | 1 `course` + 4 `redesign` + 60 `tweak` | dormant at purchase; 24h from tee-off |
| `caddy_topup_1` | £5 | 1 `redesign` + 10 `tweak` | never |
| `caddy_topup_3` | £12 | 3 `redesign` + 30 `tweak` | never |
| `caddy_topup_course` | £8 | 1 `course` + 1 `redesign` + 20 `tweak` | never |

Grant sizes exist twice by design — `lib/caddy/credits.ts:CADDY_GRANT_SIZE` / `lib/billing.ts:CADDY_TOPUPS` in TypeScript, `caddy_grant_size()` / `caddy_topup_size()` in Postgres — and are pinned equal by `tests/db/caddy-course-quota.test.ts:190,438`.

### What a "card" is

A green fee buys **five goes at one course**: one `course` credit and four `redesign` credits, spent in that order by `guard_caddy_spend` (`supabase/migrations/20260906000000_one_course_per_fee.sql:78`). `CADDY_COURSES_PER_FEE = 5` is the count of *goes*, not of saved courses. What the host keeps at the end is **one** filed course, enforced by a partial unique index on the purchase:

```sql
create unique index caddy_sessions_one_course_per_fee
  on public.caddy_sessions (entitlement_id) where course_id is not null;
```

Tearing the course out of the book (`courses` delete → `on delete set null` on `caddy_sessions.course_id`) is the release valve: it frees the slot so a remaining revision can file a replacement. `20260907000000_free_the_torn_out_course.sql:guard_caddy_session_course` exists solely to let the FK's own set-null through the one-way guard, without which every caddy course was undeletable and the valve was welded shut.

### When the clock runs

Since `20260908000000_fee_starts_at_tee_off.sql`, a green fee is **dormant** at purchase: the webhook writes `expires_at: null` (`app/api/billing/webhook/route.ts:99`), and `activate_day_pass()` stamps `activated_at` and `expires_at = now() + day_pass_hours()` on the fee *and on every grant of that fee still carrying a null expiry* the moment a round is stamped `members` by `guard_round_members`. Top-up grants belong to a different entitlement and are therefore never dated: they are durable for ever, because cost is incurred at redemption, not at sale.

### The pricing invariants

| # | Invariant (testable sentence) | Mechanism | Layer | Status |
|---|---|---|---|---|
| P1 | A green fee's per-card price is strictly lower than every top-up's per-card price. | `TARIFF` arithmetic: £12/5 = £2.40 vs £5.00 / £4.00 / £4.00 | pure | **Holds**, untested — no test asserts it |
| P2 | Each top-up rung is cheaper per card than the rung below it. | `TARIFF.caddyTopup*` | pure | **FAILS** — £8/2 and £12/3 are both £4.00 (§7.4) |
| P3 | A purchase can be fulfilled at most once. | `entitlements_stripe_event_id` unique; 23505 answered 200 | db | Asserted, unrun (`e2e/billing-webhook.spec.ts`) |
| P4 | `authenticated` can never insert, update or delete an `entitlements` row. | No write policy exists at all (`20260821000000:51`) | db | Asserted, unrun |
| P5 | A grant is minted in the same transaction as the purchase that paid for it. | `grant_caddy_package` AFTER INSERT trigger (`20260911000000:41`) | db | Asserted, unrun |
| P6 | A failed turn costs money and never a credit. | `guard_caddy_spend` early-returns on `new.failed`; `runTurn` marks failures | db + server | Asserted, unrun |
| P7 | A balance can never go negative, and an expired grant cannot resurrect. | `caddy_balance` sums live grants minus spends — two tables, never a signed ledger | db | Asserted, unrun |
| P8 | A refund removes the grants and spends it paid for. | `caddy_grants_entitlement_id_fkey on delete cascade` (`20260903000000:35`) | db | Asserted, unrun (`tests/db/rls-caddy.test.ts:691-761`) |
| P9 | Perishable credits are spent before durable ones. | `caddy_next_grant` `order by expires_at asc nulls last` | db | **FAILS** since the fee went dormant (§8.6) |
| P10 | One purchase files at most one kept course. | `caddy_sessions_one_course_per_fee` | db | **Holds only when `entitlement_id` is non-null and the course write wins the race** (§8.1, §7.3) |
| P11 | Concurrent turns cannot overspend a quota. | `pg_advisory_xact_lock` on host+ladder inside `guard_caddy_spend` | db | Asserted, unrun (stress tier) |

---

## 3. How the caddy works

The division of labour is the whole design: **the algorithm does all geometry and all resolution; the model does only taste.**

### The pipeline

`brief → gather → route graph → model loop → resolve → card`

1. **Brief** (`lib/caddy/brief.ts:readBrief`) — the only door for host input. Clamps `where`/`whereTo` to 120 chars, `note` to 120, `reachKm` to 0–40, coerces `holes`/`vibe`/`stretch` to closed menus, filters `particulars` against `PARTICULARS`, and accepts a venue id only against `/^[0-9a-f-]{36}$/i`.
2. **Gather** (`lib/caddy/places.ts:gatherPubs`) — one Text Search per named area to locate it (mean of the first 5 results as centre), then Nearby circles: one at 1.2km for a single patch, or `CORRIDOR_RADIUS_M`=600m circles sampled down the line between two ends. Requests `includedPrimaryTypes: ["pub","bar","wine_bar"]`; re-checks the *answer* with `isDrinkingPlace`. `run.ts:cachePubs` upserts every result into `venues`; `dossier.ts:buildCandidates` dedupes, caps at `MAX_CANDIDATES`=40 and numbers them `p1…p40`.
3. **Route graph** (`lib/caddy/route-graph.ts:buildRouteGraph`) — **complete walks are computed before the model is called.** Greedy + 2-opt + `swapIn` seeds, plus `snakeWalk` (forward-only greedy) and `bestForwardWalk` (an exact O(holes·n²) DP over stops sorted along the principal axis, at each drift in `driftsFor`). `ROUTE_OBJECTIVES` — ten of them — each pick one winner from the shared pool, deduped by Jaccard `overlap` against `DIVERSITY_FLOOR`. The result rides in the cached prompt prefix as `<routes>` and `<swaps>` (`routesBlock`), ids and numbers only.
4. **Model loop** (`lib/caddy/client.ts:askCaddyLooped`) — bounded by `MAX_TOOL_TURNS`=12, `CADDY_LOOP_MS`=150s, `TURN_TIMEOUT_MS`=90s per call and a runaway cost breaker. Eleven tools (`lib/caddy/tools.ts:CADDY_TOOLS`); only four mutate the draft, through the pure reducer `applyDraftTool`. If the loop drafts nothing, `fallbackBoard` dresses the graph's own best route in house defaults.
5. **Resolve** (`lib/caddy/plan.ts:parsePlan`) — the single resolver both paths go through. Drops unknown and repeated ids, clamps every string and number to the same bounds `courseSchema` uses, applies `drinkForHazard`, runs `orderWalk` then `forwardOrder`, asserts pinned tees survived, and strips a water hazard off whichever hole ended up last.

### What the model may do

Choose which pubs, from ids it was given. Choose which of the precomputed routes. Write the drink, the par, the hazard note, the fit note, the local rules and the course name. Exclude pubs and ask for a re-route without them (`plan_routes` honours `excluded`, free of charge). Search for more pubs mid-conversation. Keep and restore drafts.

### What the model may not do

Emit a pub name (no tool input and no schema field anywhere accepts one). Emit an id nobody minted. Decide the walking order — `orderWalk` and `forwardOrder` run after it and overwrite the sequence. Put water on the last hole or a hazard on the first. See a pub name in its own replayed history: `asWire` replays past assistant turns as candidate ids.

### Where "never invent a pub" is enforced

Four places, in order of the request:

1. **Schema** — `plan.ts:planSchema` makes `candidateId` a JSON-Schema `enum` of the dossier's ids, so a constrained decoder cannot emit anything else (single-shot path only).
2. **Tool reducer** — `tools.ts:applyDraftTool` refuses an unknown id as a sentence the model reads and corrects (tool-loop path).
3. **Server resolution** — `plan.ts:parsePlan` resolves every id against the dossier and drops what it cannot find.
4. **The dossier itself** — every candidate is a `venues` row upserted from a live Google Places response, and each hole gets that row's real `venue_id` and coordinates.

This is genuinely well built. It has one structural weakness: layers 1–4 all check against `caddy_sessions.dossier`, and that column is directly writable by its host over PostgREST (§8.4).

---

## 4. What is stored, and for how long

| Table.column | Why it exists | Retention | Who can read |
|---|---|---|---|
| `entitlements` (`user_id`, `kind`, `stripe_event_id`, `stripe_session_id`, `amount_total`, `currency`, `expires_at`, `activated_at`) | The only record money moved; idempotency key; the day-pass clock | For ever; cascades with the profile | Owner, plus round members when `round_id` is set (always null today). Writable only by `service_role` |
| `caddy_grants` (`host`, `entitlement_id`, `quota`, `amount`, `expires_at`, `reason`) | What a host was given | For ever, unless the purchase is deleted (cascade) | Owner only by policy — **but `caddy_balance`/`caddy_next_grant` are definer RPCs open to any uuid (§8.3)** |
| `caddy_spends` (`grant_id`, `host`, `session_id`, `turn_id`) | The counter a balance reads against | For ever | Owner only |
| `caddy_sessions.brief` (jsonb ≤4000 chars) | The host's own words, the patch, the chips | For ever | Host only; no official's view |
| `caddy_sessions.dossier` (jsonb ≤200000 chars) | The 40-pub candidate list — Google's editorial summaries and review snippets — and the model's cached prompt prefix and id allowlist | **12h nominally** (`RESUMABLE_HOURS`), swept by `sweepCaddyDossiers` — but the sweep runs only inside `closeCaddySession`, i.e. when that same host later saves a course. No cron exists in the repo. An abandoned session keeps it indefinitely (§8.16) | Host only, and host-**writable** (§8.4) |
| `caddy_sessions.entitlement_id`, `course_id`, `completed_at` | Which purchase, which filed course, when stamped | For ever | Host only; `course_id` one-way by trigger |
| `caddy_turns` (`kind`, `ask` ≤200, `result` jsonb ≤100000, `model`, four token counts, `cost_micropence`, `failed`) | The audit trail, the transcript and the bill | For ever; append-only (select+insert grants only, no update/delete policy) | Host only |
| `caddy_turns.trace` (jsonb ≤16000) | Tool calls with inputs and reply **sizes** — never replies, which carry Places content | For ever | Host only. **Nothing in `app/`, `lib/data/` or `components/` reads it back** (§8.13) |
| `bug_reports.caddy_session_id` | The private join from a complaint to the conversation | For ever | Reporter only; never printed on the public issue |
| `venues` (`google_place_id`, `name`, `address`, `lat`, `lng`, `rating`, `review_count`, `fetched_at`) | The shared Places cache; where each hole's real venue id and coordinates come from | **For ever, never swept** — every one of ~40 candidates per plan, most of which never reach a course (§8.15) | Everyone; **updatable by any authenticated user** (§8.2) |
| `courses` / `course_holes` | The builder's output the caddy files into | For ever, or until torn out | Owner only; full CRUD grant, almost no CHECKs (§8.5) |

Everything cascades to nothing when the profile is deleted (`profiles → auth.users on delete cascade`).

---

## 5. The covenant, as enforceable rules

| Clause | Rule a test could check |
|---|---|
| Joining is free for ever | `join_round(code, name)` reads no entitlement and no grant. A signed-out anonymous guest can join a round hosted by an account with no `entitlements` row. |
| What's free stays free | The manual builder, `PlaceSearch`, `PubMapSheet` and `createCourse`/`updateCourse` reach no billing module. `grep -L` over `components/course/*` minus `caddy-*` for `billing`/`tariff` returns everything. |
| No clawbacks | A round already stamped `members` never loses it: `guard_round_members` raises 42501 on true→false (proved by `tests/db`, unrun here). A course already filed is never deleted by expiry — nothing in the codebase deletes a `courses` row except the owner. |
| The host pays, never the table | `startGreenFeeCheckout` sets `client_reference_id` to the *buyer's* uid; `holds_day_pass(rounds.host)` is the only check `guard_round_members` makes. No player-side surface reads any money state. |
| Money speaks only at round creation and the results afterglow | Currently **unenforceable as written** — money speaks on `/courses/new` too (§7.1). A checkable form: "no component outside `components/round/` and `app/tariff` renders a price string or opens a Checkout session." That test fails today. |
| No guilt declines | Every money sheet's dismiss action is neutral: `GreenFeeSheet` "Not this round", `CaddyGroup` "Not yet", `ManageCourseSheet` "Keep it". A test can assert no dismiss label contains a negative-consequence clause. |
| No countdown sales clocks | `PassClock` counts a pass already bought, never one on offer. Checkable: no `useCountdown` mounts inside a component that also renders a Checkout button. |
| One honest tariff | Every price string on any public surface derives from `TARIFF` via `sticker()`. Checkable by grep for `£` literals outside `lib/tariff.ts` — **this test fails today** (§8.7). |

---

## 6. Invariants — the complete list

*Layer: `pure` = a pure function, `server` = a server action or route, `db` = a Postgres policy/trigger/constraint, `copy` = a string. "Proven" means a test asserts it; the unit tier was run for this document, the db/stress/e2e tiers were not.*

**Never invent a pub**

1. No tool input and no output schema field accepts a pub name. — `tools.ts:CADDY_TOOLS`, `plan.ts:planSchema` — pure — **proven** (unit).
2. A candidate id the server did not mint never reaches a hole. — `applyDraftTool`, `parsePlan` — pure — **proven** (unit).
3. Every hole's `venue_id` and coordinates come from a `venues` row upserted from a live Places response. — `run.ts:cachePubs`, `plan.ts:parsePlan` — server — **not proven**; no test crosses gather→card.
4. The candidate id space has no duplicates within a session. — `dossier.ts:buildCandidates` — pure — **VIOLATED** (§8.9); tests avoid it by fixture choice.
5. The id allowlist is not writable by the host. — intended; **VIOLATED** by the `dossier` column grant (§8.4) — db — no test.
6. Only pubs, bars and wine bars reach the dossier. — `places.ts:isDrinkingPlace` + `includedPrimaryTypes` — server — **proven** at the unit level for the Nearby leg; the Text Search leg passes anything with no `primaryType` (§7.7).

**Routing**

7. A route never doubles back. — `bestForwardWalk` (monotone by construction) + `forwardOrder` — pure — **proven** (property-based, `tests/unit/caddy-pathfinding.test.ts`).
8. `orderWalk` never returns a longer walk than it was given. — `route.ts:orderWalk` — pure — **proven**.
9. Pinned tees survive routing. — `orderWalk` `fixFirst/fixLast`, `parsePlan` `pin-moved` — pure — **proven** in unit tests; **unreachable in production** (§8.14).
10. `forwardOrder` is idempotent and deterministic. — coordinate-keyed tie-break — pure — **proven**.
11. The ten objectives produce genuinely different winners. — `ROUTE_OBJECTIVES` + `overlap` ≥ `DIVERSITY_FLOOR` — pure — **proven**.
12. The spacing chip changes the route target. — `targetKmFor(stretch)` — pure — **VIOLATED at the join** (§8.10); each half is proven in isolation, the join is untested.
13. A named destination outranks the pace chip. — `targetKmFor`, documented at `brief.ts:157` — pure — proven in isolation.
14. What `try_route` reports is what the group walks. — claimed by `tools.ts:353` — pure — **VIOLATED** (§8.11).
15. Two named areas anchor the walk's axis. — `buildRouteGraph:nearestTo(aimFrom/aimTo)` — pure — **VIOLATED in production** (§8.8); proven only with hand-passed coordinates.

**Money**

16–26. See §2's table (P1–P11).
27. A turn that produced no card costs no credit. — `guard_caddy_spend` — db — asserted, unrun.
28. A plan racing a roll cannot take the same credit twice. — advisory xact lock — db — asserted, unrun (stress).
29. The quota a turn spends is decided by the server, not the caller. — **VIOLATED**: `caddy_turns.kind` comes from the browser (§8.5).
30. The model is never called before the allowance is checked. — `openPlan` does this; `askTheCaddy` does **not** (§8.12) — server — no test.
31. Fair use is a volume backstop above what any fee can grant. — `caddy_fair_use_cap()` = 25 vs 65 turns per fee — **VIOLATED** (§7.5).

**Privacy and audit**

32. A round code never reaches the public issue. — `lib/bug-report.ts:redactRoundCodes` — pure — **proven** (unit).
33. `caddy_session_id` never reaches the public issue. — `issueBody` — pure — **proven**.
34. Free text is fenced so an `@everyone` is inert. — `neutralise` — pure — **proven** for the bug-report fence; the dossier's `"""` fence is a different delimiter and is **not** neutralised (§8.17).
35. A caddy session is visible to its host and nobody else. — `caddy_sessions` RLS — db — asserted, unrun; **but a stranger's entitlement can be pointed at** (§8.18).
36. Every model call is recorded with its model, tokens and cost. — `runTurn:record()` — server — no test.
37. Every plan's tool sequence is recorded. — `trimTrace` — pure — bounded correctly, but `changed` is always false (§8.13) and rolls/tweaks record no trace at all (§8.13).
38. Google review text is deleted within ~12 hours. — `sweepCaddyDossiers` — server — **VIOLATED** for abandoned sessions (§8.16); ratings are permanent regardless (§8.15).

**Deployment**

39. Every migration is readable by the currently-deployed code. — process rule, `DEPLOYMENT.md` — **VIOLATED twice** (§8.2 in the historical sense, §7.9).

---

## 7. Open questions

Ranked by how much the answer changes the work.

### 7.1 — Where is money allowed to speak? (blocker; changes the most code)

**The contradiction.** R6 says money speaks only at round creation and the results afterglow. The caddy is sold on the drafting table:

- `components/course/caddy-group.tsx:705,782` renders `Green fee · £12` as a badge on the *collapsed, unopened* card — before any host action.
- `:931` — "The caddy comes with the green fee — £12, one round, the whole table."
- `:482-555` — the spent sheet renders three priced top-up buttons and `topUp()` launches a Stripe Checkout that returns to `/courses/new?caddy=topped-up`.

The code has already invented an exemption without stating it: the inline comment at `:512-517` argues "the covenant forbids money *interrupting*, not money *answering*." Meanwhile R14 requires top-up SKUs to exist and therefore to be buyable somewhere. R6 and R14 cannot both be read literally.

**Options.**
- *(a) Strict R6.* No price on the drafting table at all. The collapsed card says only "Let the caddy plan it", and both the fee and the top-ups are sold from `/new` and `/tariff`. Consequence: a spent host must leave the page they are on to buy anything, and the "offer only answers a refusal" property is lost — the offer would appear on a screen they went to for another reason, which is arguably a worse covenant breach.
- *(b) Codify the answering exemption.* Money may appear on any screen **only** in response to a refusal the host walked into, never unprompted. Consequence: the badge and the footer sentence go (they are unprompted); the spent sheet stays and must be made reachable (§8.3). This is the smallest change and matches what the code already believes.
- *(c) Widen R6 to "money speaks where the paid thing lives."* Consequence: the covenant stops being checkable and the tariff's "one honest tariff" promise weakens.

**Recommendation: (b).** It preserves the covenant's actual spirit — no interruption, no guilt, no clock — while letting a paid feature be paid for where it is used. It also yields a testable rule: *no component may render a price string except in a surface whose open state was set by a refusal, or on `/tariff` and `/new`.* Under (b) the collapsed badge and the footer sentence at `caddy-group.tsx:705,782,931` are straightforward deletions, and R6 should be amended in writing to say so.

### 7.2 — What happens at the tear-out moment? (blocker for R13)

**The contradiction.** R13 demands a modal with "a door to buy more or just tweak". R6 forbids money outside round creation. The code has resolved this in R6's favour silently: `lib/caddy/credits.ts:tearOutWarning` produces all three correct sentences, but `components/course/course-builder.tsx:775-778` renders whichever applies as one line of hazard-ink text above a `HoldToConfirm`. No sheet, no purchase door, no "just tweak" affordance.

**Options.**
- *(a) Full R13.* A sheet on tear-out with the count, a top-up button and a "just tweak instead" action. Consequence: a second money surface on the drafting table — acceptable under 7.1(b), since the host walked into it.
- *(b) Keep the paragraph, add the two doors.* Modal-free, but the "buy more" and "tweak instead" actions become buttons beside the warning.
- *(c) Status quo.* R13 stands unimplemented.

**Recommendation: (a), conditional on 7.1(b).** The tear-out is destructive and irreversible-ish (the course goes; the credit does not come back — `caddy_spends` is never refunded), and it is exactly the moment R13 was written for. A hold-to-confirm under a 11px line is not a warning. Note the count register: `tearOutWarning` already says "N more **goes** at it", which is the correct wording and should be the house register everywhere (see §8.7).

### 7.3 — What grants the right to keep a course?

**The contradiction.** R11 says one caddy course as the final output. The rule is implemented as `unique (entitlement_id) where course_id is not null` — keyed on the **purchase**, not on the `course` quota. Three consequences:

1. `caddy_topup_1` (£5, `keepsACourse: false` at `credits.ts:229`) is its own entitlement and therefore gets its own free kept-course slot. The £8 rung's only advertised differentiator is not enforced anywhere on the server; the only thing normally preventing the second card is `lib/data/caddy.ts:feeFiledCourse`, which hardcodes `.eq("kind","green_fee")` and returns null the moment no live fee exists, after which `course-builder.tsx:353-363` mints a fresh course.
2. A comped grant produces `entitlement_id = null` (`run.ts:180-183`), and nulls are distinct in a unique index — the migration says so outright at `20260906000000:158-160`. Such a session is unconstrained.
3. Two live green fees make `feeFiledCourse` (newest by `created_at`) and `liveFee` (oldest by `caddy_next_grant`'s ordering) name different purchases.

**Options.**
- *(a) Key the slot on the `course` quota.* Filing a course consumes a `course` credit, checked server-side; only `green_fee` and `caddy_topup_course` mint one. Consequence: a real migration (a `course_id` write becomes a guarded operation, not a link), but the rule finally means what the tariff says it means, and the null-entitlement hole closes with it.
- *(b) Keep the index, patch the leaks.* Make `entitlement_id` NOT NULL for sessions that may file, and teach `feeFiledCourse` about every kind. Consequence: cheaper, but `caddy_topup_1` still buys a kept course and the £8 rung remains a label.
- *(c) Accept it.* Re-price `caddy_topup_1` as a course-keeping rung and drop `keepsACourse`.

**Recommendation: (a).** R11 is the strongest requirement in the brief ("no gaps allowing more courses to be generated AND SAVED"), and the current mechanism is a unique index on a nullable column with a client-side helper as its only real guard. The quota already exists, is already granted, and is already spent by `guard_caddy_spend` — making it also gate the *keep* is the smallest honest fix. It also removes the need for §8.1's separate race fix, because the credit check would run in the same transaction as the link.

### 7.4 — Do top-ups actually get cheaper with volume?

**The contradiction.** R14 says they must. Per whole card: `caddy_topup_1` £5.00, `caddy_topup_course` £4.00 (2 cards), `caddy_topup_3` £4.00 (3 cards). The ladder flattens at rung two, and the £8 rung delivers the same rate *plus* a kept-course slot — so the £12 rung buys nothing extra per pound. The buttons also render in array order £5, £12, £8 (`caddy-group.tsx:522-547`), which is neither price nor value order. The green fee remains comfortably the best deal on both axes (£2.40/card, 12 tweaks/card vs 10), so R14's headline holds.

**Options.** *(a)* Drop `caddy_topup_3` to £10 (£3.33/card) — restores the gradient, keeps three rungs, but £3.33 approaches the fee's £2.40 and thins the fee's advantage. *(b)* Retire `caddy_topup_3` — two rungs, which is what `credits.ts:194` still claims. *(c)* Raise `caddy_topup_course` to £9 (£4.50/card) so the course slot is priced as a premium and £4.00 stays the volume floor.

**Recommendation: (c), plus reordering the buttons £5 / £8 / £12.** It restores a monotone per-card gradient (£5.00 → £4.50 → £4.00) without narrowing the fee's advantage, and it prices the kept-course slot as the differentiator the copy already says it is. Note this only makes sense alongside 7.3(a) — if a £5 top-up silently keeps a course too, no price ladder is honest.

### 7.5 — Fair use (25/day) is below what a fee grants (65)

**The contradiction.** `caddy_fair_use_cap()` = 25 non-failed turns per rolling 24h. A green fee grants 1 + 4 + 60 = 65 turns, and its day is exactly 24 hours once activated. A host who tees off and then works their card cannot reach more than 25 of the 65 turns they paid for. The cap is described in the migration as "armour against a script, set several times above a heavy honest session" — that sizing predates the 60-tweak allowance.

**Options.** *(a)* Raise the cap to 70+. Consequence: the backstop stops being meaningful against a determined script, though `guard_caddy_spend` now provides the real ceiling. *(b)* Cut the tweak allowance to something reachable — say 20. Consequence: changes what has been sold. *(c)* Make the cap per-hour rather than per-day (e.g. 15/hour), which throttles a script without capping an evening.

**Recommendation: (c), or (a) if simplicity wins.** Since `20260904000000` removed the money budget, `guard_caddy_spend` is the ceiling that matters and fair use is only anti-script armour — a rate limit, not a quota, is the right shape for that job. Whichever is chosen, `guard_caddy_fair_use` and `guard_caddy_spend` must stop sharing an error code (§8.8).

### 7.6 — Does the model get to reorder holes?

**The contradiction.** `lib/house-rules.ts:NOT_THE_CADDYS` tells the model "the walking order… leave the sequence alone." `lib/caddy/tools.ts:336` offers it `move_hole`. `plan.ts:475,502` then runs `orderWalk` and `forwardOrder` over whatever it produced, so both the chosen route's ordering and every `move_hole` call are overwritten. The same prefix also carries two contradictory `try_route` instructions (`plan.ts:189-191` says use it only on a combination you assembled; `tools.ts:353` says use it before every handover and again after every change — the exact instruction `docs/CADDY-HANDOFF.md:38-40` records as having previously made the model search instead of drafting).

**Options.** *(a)* Delete `move_hole`, keep `NOT_THE_CADDYS`, and remove the `try_route` sentence from the tool description. Consequence: the model's job is purely selection and dressing; the prompt becomes consistent; some tokens saved. *(b)* Keep `move_hole` and stop `parsePlan` re-ordering a board that was deliberately sequenced. Consequence: R26 ("routes must not double back") stops being guaranteed by construction.

**Recommendation: (a).** R18 is explicit that the model is a curator, not a route planner, and `bestForwardWalk` is exact — there is nothing for `move_hole` to improve. This also fixes §8.11 for free, because with no reordering tool the `try_route` promise becomes true if `tryRoute` also runs `forwardOrder`.

### 7.7 — Should an untyped Places result be admitted?

R21 is "only pubs and bars." `lib/pub-search.ts:39` returns `true` for a result with no `primaryType`, argued deliberately at `:31-35` ("dropping a genuine pub for a thin response is a worse failure"). That is right for the Nearby leg, where the *request* already restricted types. But the Text Search leg (`places.ts:236`, `"pubs in X"`) carries no type restriction and its results join the same pool (`:255`) — so a restaurant or club with an absent `primaryType` can reach the dossier through the one door with no other guard behind it.

**Recommendation:** keep the permissive branch for Nearby results, flip it to `false` for Text Search results. The Text Search leg exists to *locate an area*, not to supply candidates; the strictest fix is to stop pushing its results into `found` at all.

### 7.8 — Must the caddy name the course?

R25 says the model must give a novel name. It is instructed to (`plan.ts:200-204`) and has a `name_course` tool, but nothing enforces arrival: `plan.ts:511-513` falls back to `"${patch}, ${holes} holes"` ("Shoreditch, 9 holes"), and `fallbackBoard` deliberately leaves the name empty so that formula fills in.

**Options.** *(a)* Refuse to hand over an unnamed board while turns remain, so the house formula is only ever reached after the model has had its chance. *(b)* Accept the formula as the floor. **Recommendation: (a)** — it is a two-line change in the loop's break condition and costs nothing when the model behaves.

### 7.9 — Was the `20260831` drop an accepted outage?

`20260831000000_caddy_ledger.sql:66-71` drops `caddy_unspent_fee`, `caddy_credits_left`, `guard_caddy_credit`, the `caddy_credits` table and `caddy_courses_per_fee()`, justified as "nothing read these but the app on this branch, and the app on this branch is deployed together with this file." Per R8, `CLAUDE.md` and `DEPLOYMENT.md`, the two integrations do **not** wait for each other, so the previously-deployed build's caddy path answered 42883 on every plan during the skew. It has already run on preview; the question is whether that was a knowing choice or a rule that lapsed.

**Recommendation:** treat it as a lapse and reassert the rule in writing, because §8.2 shows the same class of mistake shipping again with worse consequences. A drop belongs in a migration that lands one deploy *after* the last build that could call it.

### 7.10 — Should the report carry the turn, not just the session?

R28 says a bug report must identify the exact session **and result**. `bug_reports` gained only `caddy_session_id` (`20260910000000:74`). A session holds up to twelve turns across a twelve-hour window, so a triager reaches the conversation and then guesses which card by comparing timestamps — weakest exactly where the trace is null (rolls and tweaks, §8.13). The drafting table already holds the turn id.

**Recommendation:** add a nullable `caddy_turn_id` alongside it. Additive, cheap, and it is what makes R28's "feedback loop" a loop rather than a filing cabinet.

### 7.11 — Retention: cron or reword?

The privacy page promises Google's descriptions, ratings and review snippets are "held only for as long as you are working on that course — about half a day — and are then deleted." Neither half is true (§8.15, §8.16).

**Options.** *(a)* Add a `pg_cron` sweep running as `service_role` over `caddy_sessions` past `resumableSince`, and give `venues` a rating/review-count expiry or stop caching them. *(b)* Reword the page to describe what the lazy sweep guarantees and disclose the permanent `venues` row. **Recommendation: (a) for the dossier, (b) for `venues`** — the dossier holds the review *text* and is worth deleting on a schedule; the `venues` row is the app's own operational cache of name/address/coordinates and should simply be disclosed rather than pretended away.

### 7.12 — Should the tariff list the top-ups?

`/tariff` lists the green fee and the honesty box only, while its own docstring claims "pricing, refund policy, and a contact all live on this one card" for payment processors. Three purchasable SKUs are absent, and `/small-print`'s delivery clause ("unlocks on your round") is untrue of a top-up, which unlocks on the drafting table and outlives every round.

**Recommendation: list them.** The "offered only in answer to a refusal" rule is about *marketing*, not about disclosure; a processor-facing price list that omits three-quarters of the SKUs is the more serious risk. Listing them on `/tariff` does not put a sales moment anywhere new.

### 7.13 — Two small register questions

- **Does R4 bind the privacy notice?** `app/legal/privacy/page.tsx:99-112` names Anthropic and Vercel's AI Gateway — the only production surface that names the machinery. It reads as a deliberate processor disclosure. *Recommendation: yes, standing exception, stated in R4.*
- **Does R4 bind text the caddy writes about itself?** The wait panel renders `thinking` and `doing` verbatim (`caddy-group.tsx:579-599`), including the model's own search query and its ≤120-char exclusion reasons; `thinkingTail` only flattens and clamps, and `CADDY_SYSTEM` contains no rule against self-reference. *Recommendation: add one line to `CADDY_SYSTEM` ("you are the caddy; never refer to yourself as a model, an AI, or a system") rather than a filter — a vocabulary filter on streamed text will mangle legitimate copy, and the register rule is exactly the kind of thing a prompt can hold.*

### 7.14 — Should a dormant, spent fee block buying another?

`lib/actions/billing.ts:48-56` refuses a second fee when any `green_fee` row has `expires_at is null OR > now()`. Every fee is now written null and stays null until tee-off, so a host who buys a fee, spends all five goes planning and never tees off can never buy another — and reads "Your green fee is already paid — it runs all day", which is not what happened. *Recommendation: key the guard on "a fee with credits left, or one already activated and still running", not on the row's existence.* Note this interacts with `activate_day_pass`, which picks the **oldest dormant** fee and would otherwise start the wrong one (§8.19).

---

## 8. Known violations

Ranked by severity. Each is a clear defect against a stated requirement or a stated promise; none needs a product decision.

### Blockers

**8.1 — Two tabs file two saved courses from one fee.** `components/course/course-builder.tsx:353-363` mints the course first (`createCourse`) and only then attempts the link; `lib/caddy/run.ts:834-845:rememberCaddyCourse` issues the update with no error check and its own docstring concedes "a duplicate course at worst". `savedId` is React state seeded once at `:201`. The 23505 from `caddy_sessions_one_course_per_fee` is discarded — the course is already in the book. Violates R11 outright. *Fix: check the link result and delete or re-point the minted course on 23505 — or adopt §7.3(a), which removes the race entirely.*

**8.2 — Any signed-in user can start another host's day-pass clock.** `public.activate_day_pass(who uuid)` is `security definer`, takes an arbitrary uuid, performs two writes, and is granted to `authenticated` (`20260908000000:80,116`). It is a `public`-schema function, so it is an ordinary PostgREST RPC — an anonymous guest holds the `authenticated` role. The migration's justification ("it names no row and returns nothing") is about its output, not its writes. Violates R32 and R17. *Fix: revoke from `authenticated`; make `guard_round_members` `security definer` so it can call it, or inline the two UPDATEs into the guard.*

**8.3 — Any signed-in user can read another host's ledger.** `caddy_balance(who, quota)` and `caddy_next_grant(who, quota)` are `security definer` with an arbitrary `who` and granted to `authenticated` (`20260831000000:148-181`). This contradicts the read-your-own policies in the same file — and `tests/db/rls-caddy.test.ts:964` ("shows a host their own ledger and nobody else's") exercises only the tables, not the RPCs. *Fix: default `who` to `auth.uid()` and refuse any other value, or drop the parameter.*

**8.4 — Any authenticated user can rewrite any pub in the shared cache.** `create policy "venues are refreshable" on public.venues for update to authenticated using (true) with check (true)` (`20260807000000:77-79`), on a table with a blanket CRUD grant. The narrowing to "rating/fetched_at" exists only in the comment. One PATCH renames a real pub or moves its coordinates for every user. `swapHolePub` and `pinCoords` read those columns straight off the row. This is the most direct route to "a door that isn't there" in the codebase — the worst failure R2 names. *Fix: restrict the policy's `with check` to rows whose `google_place_id` is unchanged, and move the refresh to a definer function that only writes `rating`, `review_count`, `fetched_at`.*

*(Related, same rule: `caddy_sessions.dossier` is host-writable via `grant update (completed_at, dossier, course_id)` at `20260827000000:35`. That array is both the model's prompt prefix and the id allowlist all four "never invent a pub" checks resolve against, and `run.ts:593` casts it back with no validation before `plan.ts:441` writes `venue_name: candidate.name` onto the card. The gain over the free manual builder is attribution — a fabricated pub wearing the `CaddyPennant` — not access. Fix: replace the `dossier` grant with a definer `sweep_caddy_dossier(session_id)` that can only ever write `[]`, and have `parsePlan` re-read the name from `venues` by `venue_id` rather than trusting the dossier copy.)*

**8.5 — The client chooses which quota it spends.** `guard_caddy_spend` branches purely on `new.kind` (`20260906000000:108`); `caddy_turns.kind` is set by `run.ts:628` from `input.roll ? "roll" : "tweak"`, and `roll` arrives from the browser through `lib/actions/caddy.ts:46-53`. A tweak turn's `result` is a complete `PlannedCourse` exactly as a roll's is, so asking for a wholly different card with `roll:false` draws on the 60-deep tweak quota instead of the 4-deep redesign one. The `caddy_turns` INSERT policy checks host and session only. Violates R10 and R32. *Fix: derive `kind` server-side from whether the ask scopes to a hole, or — better — have the guard compare the new `result` against the previous turn's and treat a wholesale replacement as a redesign.*

**8.6 — Adding the `course` quota left a window where every green-fee purchase was charged and granted nothing.** `20260905000000:28` adds the enum value and nothing else (correctly — Postgres forbids using it in the same transaction). But `grant_caddy_package` mints from `unnest(enum_range(...))`, and until `20260906000000:38` lands, `caddy_grant_size` is the `20260901000000:21-24` body with no `course` arm and no `else` — it returns NULL, and `caddy_grants.amount` is `integer not null check (amount > 0)`. The AFTER INSERT trigger raises 23502 and aborts the whole `entitlements` insert: the webhook 500s, Stripe retries for ever, the buyer is charged and granted nothing. Violates R8. *Fix (forward-looking): give `caddy_grant_size` an `else 0` arm and have `grant_caddy_package` skip zero amounts, exactly as `caddy_topup_size` already does. The comment at `20260906000000:34-37` also misdescribes the failure — NOT NULL rejects it before any "unlimited grant" reading arises.*

**8.7 — The public tariff page quotes two different green fees on one card.** `app/tariff/page.tsx:33-34` hardcodes "the £4 green fee reads $5, €5, C$7 or A$8 abroad"; the `DotLeaderRow` ten lines below renders `GREEN_FEE_PRICE` = "£12" from `TARIFF`. The real foreign amounts are $15 / €15 / C$21 / A$24. This is the page the file's own docstring says payment processors land on. *Fix: derive the sentence from `TARIFF.greenFee.amounts` or delete it.*

**8.8 — Terms says there is nothing to buy.** `app/legal/terms/page.tsx:19-23`: "It is free, it is a personal project rather than a company, and there is nothing to buy anywhere in it." There is a £12 fee, three top-ups and an honesty box; `app/legal/privacy/page.tsx:101` already calls the caddy "the paid extra", so the two house papers contradict each other. Terms also carries no refund, delivery or payment clause at all.

### Major

**8.9 — A mid-conversation search shadows the dossier, so the caddy's chosen pub is not the pub on the card.** `dossier.ts:111` always numbers `p${index+1}` from 1 with no offset; `run.ts:677` returns `buildCandidates(...)` for a search, and `client.ts:626` does `candidates = [...candidates, ...answered.added]`. Every consumer builds a `Map` in which the later duplicate wins (`candidatesById`, `session.ts` `byId`, `route-graph.ts` `byId`). After one `search_pubs`, `set_hole p3` puts a different real pub on the hole than the caddy chose, `boardBlock` reads the wrong name back to it, and `buildRouteGraph` receives duplicate ids. `tests/unit/caddy-session.test.ts` misses it by hand-picking non-colliding fixture ids. *Fix: give `buildCandidates` a start offset, or mint search ids in a separate namespace (`s1…`).*

**8.10 — `aimFrom`/`aimTo` are written and never read back, so A-to-B routing is dead in production.** `run.ts:548-551` and `:443-448` stamp the resolved area centres into `caddy_sessions.brief`, but `openPlan` returns the *unaugmented* brief (`:565`), and `brief.ts:216-229:readBrief` constructs a fresh object literal with no `aimFrom`/`aimTo` key — verified by reading the return. Every consumer therefore receives `undefined`: `plan.ts:290-291`, `client.ts:488-490`, `client.ts:748-749`. `buildRouteGraph`'s `nearestTo(request.aimFrom)` never fires and the walk falls back to the principal eigenvector of the candidate cloud. `run.ts:280` typing `gatherFor`'s return as `from: unknown; to: unknown` is what keeps the compiler quiet. Violates R22/R23. *Fix: read both keys back in `readBrief`.*

**8.11 — The spacing chip is inert on every single-patch round.** `caddy-group.tsx:269` posts `reachKm: reach?.km ?? 0` with no `whereTo` guard, while the same component guards its on-screen pace at `:184`. `reach.ts:57` returns `{ km: 1.2 }` for a single patch — a *ring radius*, not a reach. `route-graph.ts:924` then does `if (reachKm > 0) return reachKm * 1.15` and never reaches the stretch arm. Every single-patch plan is routed at a 1.38km target whether the host picked Doorstep or Stretch; at 9 holes/Stretch the honest target is 6.0km. `brief.ts:157` documents `reachKm` as "Zero for a single-patch round", which is precisely what the producer never sends. Violates R22. *Fix: post `whereTo.trim() ? reach?.km ?? 0 : 0`.*

**8.12 — `try_route`'s stated promise is false.** `route.ts:393:tryRoute` applies `orderWalk` only; `plan.ts:475,502:parsePlan` applies `orderWalk` **and then** `forwardOrder`. The tool description the model reads (`tools.ts:353`) says "This is the same router the finished card goes through, so what it reports is what the group will walk." The test that claims to pin this (`tests/unit/caddy-route.test.ts:296`) compares `tryRoute` against `orderWalk` — the half that agrees. Violates R20. *Fix: run `forwardOrder` inside `tryRoute`, and change the test to compare against `parsePlan`.*

**8.13 — `reopenCaddyPatch` cannot succeed for any host, and burns Places quota before failing.** `run.ts:439-451` issues `.update({ brief: {...}, dossier: [...] })`, but the only UPDATE grant on `caddy_sessions` is `(completed_at, dossier, course_id)` — `brief` is granted to nobody. `:452` maps every error to "That patch isn't on your table." The refused update happens *after* `gatherFor` (`:435`) has already spent a Text Search plus up to twelve Nearby calls at the dear caddy field mask. `tests/db/rls-caddy.test.ts:191-203` actively asserts a host may not write `brief`, so the suite pins the rule that breaks the feature — and the UI door ("Pick this back up") is live. Also breaks the privacy page's promise that "the caddy fetches them again rather than keeping an old copy." *Fix: write only `dossier`, and store the aim inside the dossier rather than the brief.*

**8.14 — The audit trail is largely empty, which is what R27/R28 exist for.** Three defects compound:
- `client.ts:595` executes `board = answered.board`, then `:623` computes `changed: board.holes.length !== before || board !== answered.board` — the second disjunct is always false. Every successful replace, `move_hole` and `name_course` records `changed: false`. The adjacent warning at `:609-621` has the same defect and logs "changed nothing" for every successful replace, which is exactly the diagnostic its own comment says was written to end an evening of guessing.
- `trace` is produced only by `askCaddyLooped`; `runTurn:750-754` sends rolls and tweaks elsewhere, so `record()` writes `trace: null` for **every roll and every tweak** — the turns a drafting-table bug report is most likely about.
- Nothing anywhere in `app/`, `lib/data/` or `components/` reads `caddy_turns.trace` back. The feedback loop has a writer and no reader.

**8.15 — Rolls and tweaks call the model before any allowance check, and the refusal erases the record that would have bounded it.** `askTheCaddy` (`run.ts:569-620`) gates on `caddyEnabled`, ownership, an open patch and `holds_day_pass` — never on the balance. `runTurn` calls the model and only afterwards inserts the turn row; `guard_caddy_spend` is AFTER INSERT, so its 42501 aborts the insert and no row persists, and `guard_caddy_fair_use` counts rows, so the refused turn never increments the 25/day cap either. A host with a live pass and an exhausted balance can drive unbounded vendor calls with nothing recorded. Violates R31. *Fix: read `caddy_balance` in `askTheCaddy` before the call, as `openPlan` already does via `liveFee`.*

*(The same shape exists on the Places side: `openPlan` gathers — one Text Search plus up to twelve Nearby calls — and inserts a session **before** any model call. A thin patch, a model failure or a closed tab writes no `caddy_turns` row, so neither guard ever sees it. Repeated failing plans on one live fee are unbounded Google spend, each leaving an orphan session holding a full dossier.)*

**8.16 — Durable top-ups are unreachable for rolls and tweaks without a live green fee.** `run.ts:604` and `:431` hard-require `holds_day_pass(user) === true`, and `holds_day_pass` (`20260823000000:54`) filters `kind = 'green_fee'`. A host holding only `caddy_topup_3` — 3 revisions and 30 tweaks, deliberately never expiring — can start a plan (`openPlan`/`liveFee` resolve the top-up grant fine) and then has every roll and tweak refused with "Your green fee's day is over." Violates R14. *Fix: gate on "holds any live caddy grant", not on the fee.*

**8.17 — Durable credits are spent before perishable ones.** `caddy_next_grant` orders `expires_at asc nulls last, created_at asc`. That was right while a fee carried a real expiry; since `20260908` the fee's grants also carry NULL, so both sides tie and the tie-break is `created_at`. A host holding top-ups from a previous night who buys a new fee burns the durable pack first while the fee's own credits sit unspent and then die with its 24 hours. Violates R15. *Fix: order by `reason = 'green_fee' desc` first, or by `activated_at nulls last`.*

**8.18 — Every quota exhaustion is reported as the fair-use ceiling.** `run.ts:806` maps every 42501 from the turn insert to `FULL_SHIFT` ("The caddy's done a full shift on this fee"), and its comment at `:806` claims it is "the one refusal a host can actually meet". Since `20260906000000` the same code is raised by `guard_caddy_spend` for "No revisions left" and "No tweaks left". A host who spent the 60 tweaks they paid for is told the wrong ceiling and given the wrong remedy. *Fix: read `error.message`, or give the two guards distinct SQLSTATEs.*

**8.19 — The top-up sheet cannot be opened from the spent panel.** `spent` is set only at `caddy-group.tsx:292`, `:321` and `:417` — a refusal returning from `/api/caddy/plan`/`askTheCaddy`, or a failed checkout. The dedicated spent branch at `:732-760` mounts `{spentSheet}` and calls no setter, and returns before any plan call is made. A host who exhausts their fee, closes the tab and comes back sees two free-route links and no purchase path at all. So R14's SKUs are reachable only by a host whose allowance read as available and was then refused.

**8.20 — Three on-screen answers to "what does a green fee buy".** `GREEN_FEE_EXTRAS` (`lib/billing.ts:139`) says "one course, planned for you"; the spent panel (`caddy-group.tsx:744`) says "the caddy plans **three** to a green fee" — a number that was `caddy_courses_per_fee()` in the ledger `20260831` dropped, and which sits two lines under a `<CaddyUsage left={0}/>` rendering five pips; `coursesLeftNote` says "5 **courses** left on this fee", which is the exact conflation R11 warns against — the five are *goes*, not saved courses. `tearOutWarning` already uses the correct register ("N more goes at it"). *Fix: delete the literal, and change `coursesLeftNote` to speak of goes.*

**8.21 — Point-of-sale copy starts the clock at purchase.** `components/round/green-fee-sheet.tsx:98-100` ("every round you host for the next 24 hours"), `app/tariff/page.tsx:50-53`, `lib/actions/billing.ts:56` ("it runs all day") and `course-builder.tsx:139-141` ("it started when they paid") all describe the pre-`20260908` behaviour. The correct sentence exists at `credits.ts:131-132` ("Planning starts no clock. Your fee's day begins when you tee the round off") and is shown only inside the caddy's fresh-course sheet — so the wrong one is what a buyer reads immediately before paying. Violates R17, and it is the sentence with the most commercial consequence in the app.

**8.22 — The e2e webhook spec still asserts purchase-time expiry.** `e2e/billing-webhook.spec.ts:183` asserts `Date.parse(rows[0].expires_at) === PAID_AT*1000 + DAY_MS`; the route has written `expires_at: null` since `20260908`. `Date.parse(null)` is NaN, so where this spec runs (gated on `STRIPE_WEBHOOK_SECRET`) it is red. Its header at `:18` still describes "24 hours on the clock".

**8.23 — The DB and TS copies of the budget disagree 3×, and a db test asserts they are equal.** `caddy_budget_micropence()` returns 48000000 (12% of the £4 launch fee, `20260826000000:140`); `caddyBudgetMicroPence()` derives 144000000 from the £12 `TARIFF` (`lib/caddy/budget.ts:198`). `tests/db/rls-caddy.test.ts:824-831` asserts equality — that tier should be failing. The DB copy is dead since `20260904`; the TS copy is live as the tool loop's runaway breaker (`run.ts:657`), so the breaker is 3× what the comment above it describes.

**8.24 — Every bound on a saved course lives in a zod schema.** `course_holes` has CHECKs for `number >= 1` and `par between 1 and 20` and nothing else — no hole-count cap, no length bound on `venue_name`/`drink`/`hazard_note`, no shape or size constraint on the `penalties` jsonb (unlike every jsonb column the caddy migrations added). `courses.name` is unbounded text. Both carry `grant select, insert, update, delete to authenticated` under `for all` owner-scoped policies. The 18-hole cap and the 80/120/200-char limits exist only in `lib/actions/courses.ts:courseSchema`. `createRound` (`lib/actions/rounds.ts:115-146`) then copies `course_holes` verbatim into `holes` with no re-validation, so an oversized course becomes a round every joined player loads. Violates R31 and R32.

**8.25 — Foreign keys bypass RLS, and a comment claims otherwise.** The `caddy_sessions` INSERT policy checks only `host = auth.uid()`; `entitlement_id` is constrained by nothing but its FK, and PostgreSQL referential-integrity checks run with row security off. A signed-in user may open a session against a stranger's entitlement and, by filing a course on it, occupy that purchase's one-course slot. `bug_reports.caddy_session_id` is identical in shape. `lib/actions/support.ts:128-131` asserts the reverse — "a stranger's id would be refused by the constraint on a row they cannot read" — which is not how FK checks behave.

**8.26 — The privacy notice has no payments section.** It names Google, Anthropic, Vercel's AI Gateway, Supabase and Vercel. It never mentions Stripe, never says checkout hands Stripe the buyer's uid as `client_reference_id` and `metadata.user_id`, and never mentions that `entitlements` retains `stripe_event_id`, `stripe_session_id`, `amount_total` and `currency` with no stated retention. The caddy — the page's longest new section — is sold on exactly that payment. Violates R29.

**8.27 — The public issue publishes the reporter's user-agent and language.** `lib/bug-report.ts:277-279` writes `Device` (full `user-agent`) and `Locale` (full `accept-language`) as rows on the public GitHub issue. The round code is correctly redacted and `caddy_session_id` correctly never appears — the load-bearing rule holds — but the sheet promises "your name and your round's code stay here", and the privacy page names neither GitHub as processor nor these strings as published. A UA plus accept-language pair is a fingerprint. *Fix: keep both on the private row, like `round_code` already is.*

**8.28 — Google ratings are permanent and the dossier sweep is lazy.** `run.ts:238-258:cachePubs` upserts `name`, `address`, `lat`, `lng`, `rating`, `review_count` into `public.venues` for all ~40 gathered candidates, most of which never reach a course; `venues` has no expiry and is never swept. `sweepCaddyDossiers` runs only inside `closeCaddySession` — when that same host later saves a course — and its own comment concedes "a host who never comes back leaves rows behind." There is no `pg_cron` anywhere in the repo. The privacy page says these things "are then deleted" (see §7.11 for the decision half).

**8.29 — `LEGAL_UPDATED` is stale.** `app/legal/parts.tsx:9` reads "9 August 2026" and its last commit is 2026-08-09; `app/legal/privacy/page.tsx` has changed twice since, the latter adding the entire caddy-session and report-link sections. The page's own Changes section says "if this page changes, the date at the top changes with it."

### Minor

**8.30 — The dossier's quote fence is not neutralised.** `dossier.ts:165,168` and `plan.ts:246,260` fence Google's editorial summaries, review snippets and the host's own note as `"""…"""`, but `lib/bug-report.ts:171:neutralise` only replaces triple *backticks*. Any of those strings containing `"""` closes the fence early. The id enum and `applyDraftTool` still make a fabricated pub unrepresentable, so R2's hard guarantee holds — what is exposed is everything the model writes freely (drink, par, hazard note, local rules, course name) and its tool selection, including `exclude_pubs`. `dossier.ts:184` tells the model the fence is trustworthy, which is the claim that is not enforced.

**8.31 — The collapsed caddy card says "Covered" to a host with nothing left.** `caddy-group.tsx:692-726` reads `hasPass` alone with no reference to `allowance`, and returns before the spent branch at `:732`. A host with a live-but-spent fee reads "Covered" and "ready in about twenty seconds", and must tap "Plan the round" before anything says otherwise. `components/course/caddy-usage.tsx:6-11` names this exact bug as the reason that component exists; it was fixed only in the brief branch.

**8.32 — `CaddyUsage` cannot render a topped-up balance.** `caddy-usage.tsx:22` defaults `total` to `CADDY_COURSES_PER_FEE` = 5 and both call sites pass only `left`. With any top-up, `left` can exceed 5: `spent` clamps to 0, five filled pips render, and the words beside them say a larger number. `coursesLeftNote` also attributes a balance summed across durable top-up grants (`lib/data/caddy.ts:303-327`) to "this fee".

**8.33 — Dead code, superseded paths and unreachable features.** Violates R30, which the user named explicitly:
- `askCaddyStreamed` (`client.ts:200`) is selected only when `narrate` is set with `kind !== "plan"`; no caller does that.
- Consequently `pickedIds` (`stream.ts:98`), the `picked` event, `caddy-group.tsx:312`, `course-builder.tsx:561` and `route-preview.tsx`'s pick highlighting are live code with no producer — the map never lights picks.
- `planCourse` exists twice (`run.ts:464` and the shim `lib/actions/caddy.ts:41`) with no caller; the client fetches `/api/caddy/plan`.
- `WalkShape = "loop"` (`route.ts:104`) is branched on twice and never set.
- The entire pinned-tee path is unreachable: `caddy-group.tsx:275-276` hardcodes `startVenueId: null, finishVenueId: null`. `pinCoords`, the pin hoisting in `buildCandidates`, `briefBlock`'s "Hole 1 must be pN", `parsePlan`'s `pin-moved` refusal and `buildRouteGraph`'s `startId/finishId` are exercised only by unit tests.
- `budget.ts:withinBudget`, `CADDY_BUDGET_NOTE`, `sumUsage`; `fair-use.ts:caddyTurnsSpent`, `caddyFairUseSpent`, `CADDY_FAIR_USE_NOTE`; `billing.ts:dayPassExpiry` — all referenced only by tests. The full-shift sentence exists verbatim three times and only `run.ts:FULL_SHIFT` renders, which is the exact failure `run.ts:94-103` was written to document.
- `entitlements_one_per_round` (`20260821000000:45`) guards nothing now that day passes carry `round_id` null.

**8.34 — Stale comments that a future editor will price and reason from.** `lib/tariff.ts:27-33` ("The fee is £3 a round; these are £5 and £4" — it is £2.40, and there are three rungs); `lib/caddy/credits.ts:194-196` ("Two rungs and no third") directly above a three-element array; `credits.ts:27` calls `CADDY_QUOTAS` a mirror of `caddy_courses_per_fee()`, dropped by `20260831000000:71`; `budget.ts:180-191` reasons from Opus prices and a £4 fee; `course-builder.tsx:141` says the pass's day "started when they paid". `docs/MONETIZATION.md`, `docs/CADDY-TOPUPS.md` ("Nothing here has shipped" — all three rungs have), `docs/CADDY-STAGES.md` ("Nothing here is built" — the per-call bound and the rewritten system prompt both shipped) and `docs/CADDY-HANDOFF.md` (stale by seven migrations) all describe a prior version of this feature. `CLAUDE.md` has **no mention of the caddy at all** — not `lib/caddy/`, not the four caddy tables, not top-ups, not the tee-off clock — and its data-model section stops at `20260824`.

**8.35 — Missing and dead indexes.** There is no index on `entitlements (user_id, kind)` — the predicate for `holds_day_pass`, `getDayPass`, `feeFiledCourse` and `liveFee`'s fallback, i.e. the lookup every tee-off performs. `caddy_spends` has no index on `host` though its RLS policy filters on it. `types/database.ts` looks hand-maintained rather than regenerated (`caddy_grants`/`caddy_spends` carry `Relationships: []` despite six FKs between them; `Constants.public.Enums` is `{}` though `caddy_quota` exists), so it is not evidence of the applied schema — regenerate per `CLAUDE.md`.

**8.36 — There is no db, stress or e2e coverage for any of this.** Grepping `e2e/` for "caddy" returns only the round *role* — the sober scorekeeper — in `round-flow.spec.ts` and `lobby-visual.spec.ts`. `tests/db/rls-caddy.test.ts` and `tests/db/caddy-course-quota.test.ts` exist and, per `docs/CADDY-HANDOFF.md:150-164`, have never been run on this branch. The two worst money bugs shipped so far (the grant-id-into-an-entitlement-FK in `liveFee`, and `entitlements_kind_check` refusing a top-up) were both invisible to types and unit tests and would have been caught by those two files. Running them is the single highest-value action before any of the above is fixed — several predictions in this document (§8.23's mirror test, §8.13's column refusal) are read off source and want confirming.

---

### One note on naming

"Caddy" names two different things in the product: a round *role* (the sober marker, `round_players.role = 'caddy'`) and the paid planner. A host who buys "the caddy" on `/new` and then promotes a friend to "caddy" in the lobby meets both inside one session. Nothing is broken by it, but it makes every grep ambiguous and it will make the first support conversation confusing.

---

## 9. Decisions

Settled with the product owner after the audit. Eight were put as questions;
six were taken on the audit's own recommendation and are marked *(taken)* —
any of those can still be overturned.

| # | Question | Decision |
|---|---|---|
| 7.1 | Where may money speak? | **Money may only answer a refusal.** It may appear on any screen *only* in response to a refusal the host walked into, never unprompted. The `£12` badge on the collapsed card and the footer sentence go; the spent sheet stays and must be made reachable. Testable rule: **no component renders a price except inside a refusal branch.** |
| 7.2 | The tear-out moment | **Full R13.** A sheet with the count, a top-up door and a "just tweak instead" action. Legitimate under 7.1 because the host walked into it. |
| 7.3 | What grants the right to keep a course? | **Key the slot on the `course` quota**, not on the purchase. A kept course requires a spent `course` credit, so `caddy_topup_1` can never hold one. Closes the two-tab race at the root. |
| 7.4 | Do top-ups get cheaper with volume? | **Reprice `caddy_topup_course` to £9**, giving £5.00 → £4.50 → £4.00 per card. Needs a Stripe reprice as well as a tariff change. |
| 7.5 | Fair use below what a fee grants | **Raise the cap above 65** (~80/day) so it can only ever catch a script. |
| 7.6 | May the model reorder holes? | **Delete `move_hole`.** Selection and dressing only. Also remove the contradictory `try_route` sentence from the tool description. |
| 7.7 | Untyped Places results | **Stop Text Search results becoming candidates.** That leg locates an area; it does not supply pubs. Nearby keeps its permissive untyped branch, which is safe because the request restricted types. |
| 7.8 | Must the caddy name the course? | *(taken)* **Refuse to hand over an unnamed board while turns remain**, so the house formula is only ever a floor. |
| 7.9 | Was the `20260831` drop an accepted outage? | *(taken)* **A lapse.** Reassert in writing: a drop belongs in a migration one deploy *after* the last build that used it. |
| 7.10 | Should a report carry the turn? | *(taken)* **Yes** — add a nullable `caddy_turn_id` beside `caddy_session_id`. Additive, and it is what makes the feedback loop a loop. |
| 7.11 | Retention | **Cron the dossier, disclose `venues`.** A scheduled sweep makes the dossier promise true; the permanent `venues` row is an operational cache and should be disclosed rather than pretended away. |
| 7.12 | Should `/tariff` list the top-ups? | *(taken)* **Yes.** The "offered only in answer to a refusal" rule is about marketing, not disclosure; a processor-facing price list omitting three of four SKUs is the greater risk. |
| 7.13a | Does R4 bind the privacy notice? | *(taken)* **No** — standing exception for processor disclosure, to be stated in R4 itself. |
| 7.13b | Does R4 bind what the caddy says about itself? | *(taken)* **Yes.** Add one line to `CADDY_SYSTEM` forbidding self-reference as a model or AI, rather than filtering streamed text — a vocabulary filter would mangle legitimate copy, and register is exactly what a prompt can hold. |
| 7.14 | Should a dormant, spent fee block another purchase? | *(taken)* **No.** Key the guard on "a fee with credits left, or one already activated and still running", not on the row's existence. |

### What these decisions change about the design

Two of them alter §2 and §6 materially and the earlier sections should be read
through them:

**The one-course invariant moves layer.** §2 records it as
`unique (entitlement_id) where course_id is not null`. Under 7.3 it becomes a
rule about the `course` credit, which is what was actually bought. The index
was a proxy for that and let `caddy_topup_1` — a rung with no course credit —
hold a slot.

**The covenant becomes mechanically checkable.** §5 could only state R6 as
prose because the code had invented an unstated exemption. 7.1 states it: a
price may render only inside a refusal branch. That is a rule a test can hold,
which is what the covenant needed to stop being a matter of taste.

### Where each decision landed

Written after the fact, so this section is the record rather than the plan.
Every row is in the branch; the one thing outstanding is named at the bottom.

| # | Landed as |
|---|-----------|
| 7.1 | `CaddyOffer` (`lib/caddy/stream.ts`) replaces the `spent` boolean, so a refusal names its own door: `GreenFeeSheet` for a host who has not paid, `CaddyMoreSheet` for one whose fee is used up. The badge and the footer price are gone. **`tests/unit/covenant-money.test.ts` is the rule** — an allowlist of the six modules that may hold a price. |
| 7.2 | `tearOutWarning` → `tearOutNotice`, returning `canReplace`/`canTweak` beside the line, and `components/course/tear-out-sheet.tsx` renders both doors above the hold-to-confirm. Money appears only when the caddy genuinely cannot replace what is going. |
| 7.3 | `20260913000000_slot_follows_the_credit.sql`. The unique index is gone; `guard_caddy_course_slot` counts spent `course` credits against filed courses under an advisory lock. Probed on preview: six cases, all correct. |
| 7.4 | £9 in `lib/tariff.ts`, in `scripts/stripe-seed.mjs` (whose *foreign* ladder was also stale — cad and aud were two rungs behind), and in Stripe test mode via `transfer_lookup_key`. |
| 7.5 | `caddy_fair_use_cap()` 25 → 80, in the same migration as 7.3. |
| 7.6 | `move_hole` deleted — tool block, constant, `DRAFT_TOOLS` entry, reducer arm — and the prompt no longer offers it. The `try_route` description stops telling the caddy to measure what it was just told. |
| 7.7 | `gatherPubs`'s Text Search leg no longer pushes results into the candidate pool. It locates the area; Nearby fills the patch, under `includedPrimaryTypes`. |
| 7.8 | The loop asks once for a name before handing over an unnamed board. `parsePlan`'s formula goes back to being a floor. |
| 7.9 | Recorded, not coded: a drop belongs in a migration one deploy *after* the last build that used the thing. |
| 7.10 | `20260914000000_report_names_the_turn.sql`: `bug_reports.caddy_turn_id`, guarded by `owns_caddy_turn` because a foreign key check runs with row security off. Threaded from the `card` event through the drafting table. Probed on preview. |
| 7.11 | `20260915000000_sweep_the_dossier.sql`: `sweep_caddy_dossiers()`, scheduled hourly by pg_cron behind an availability guard so a stack without the extension still applies the migration. The notice now also discloses `venues`. |
| 7.12 | `/tariff` lists all three top-ups and reads its foreign prices off the price object — the sentence above the board had been naming the £4 launch fee under a board rendering £12. |
| 7.13a | No code. |
| 7.13b | One line in `CADDY_SYSTEM`: the caddy is the club's caddy and does not call itself a model, an AI or an assistant. |
| 7.14 | `secondFeeRefusal` in `lib/billing.ts`, pure and tested. A running fee refuses; a dormant one refuses only while it can still do something. The bug it fixes: a fee bought, spent and never teed off had `expires_at` null, which read as "live" and locked its owner out of buying another. |

**Outstanding.** The live Stripe account is not reachable from this
environment and still carries the £4 green fee with no top-up SKUs at all. It
needs `node scripts/stripe-seed.mjs` against the live key before the caddy is
sold to anybody.
