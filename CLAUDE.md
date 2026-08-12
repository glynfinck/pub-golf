# Pub Golf

This is NOT the Next.js you know: v16 has breaking changes — check
`node_modules/next/dist/docs/` before writing framework code. `proxy.ts`
is this Next version's middleware convention (see the `home` sibling repo).

## Conventions

- Mirrors the `home` repo: npm, Tailwind 4 (`@theme inline` tokens),
  `@supabase/ssr` clients in `lib/supabase/`, next-themes with `.dark` class.
- Components are **shadcn/ui** (radix-nova style, `components.json` matches
  `home`) — add new ones with `npx shadcn add <name>`, never hand-roll a
  primitive shadcn provides. House customizations live in the generated
  files: Button default size is min-h-12 (thumb target), Input is min-h-12,
  `FieldLabel` (eyebrow-styled Label) is exported from `ui/input.tsx`.
  Domain components (Chip, Avatar initials, HazardPill, Countdown) stay
  custom in `components/ui` and `components/round`.
- House style tokens live in `app/globals.css` — cream/fairway/marker/hazard.
  Never hardcode colors; use the semantic tokens. No emojis in UI — inline
  SVG or lucide icons only.
- Mobile-first: every screen goes through `components/shell/screen.tsx`
  (max-w-md column). Tap targets ≥ 44px (buttons default to 48px).
- `lib/course-templates.ts` holds the Invitational fixture (the printed
  scorecard); user-built courses live in `courses`/`course_holes` and are
  snapshotted into `holes` at round creation.
- The builder's map (`components/course/pub-map-sheet.tsx`) is a
  cloud-styled **Google** vector map on purpose: Google's terms put Places
  results on a Google basemap only, so the theming lives in one
  console-authored map ID (`NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`, riding
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — a browser key, never the server's
  Places key) that holds a cream style in its light slot and Midnight in
  its dark slot; `colorScheme` selects the variant, and the house draws
  its own pins. The style masters are vendored in `docs/map-styles/`
  (Google's stylesheet JSON, every taxonomy feature pinned so no default —
  blue in the dark variant — bleeds through); re-import them via Map
  styles → Create style → JSON if the console copies are ever lost. The
  legacy `_CREAM`/`_MIDNIGHT` env names are still read as fallbacks. The
  search route aims every query — viewport bounds when the map framed one,
  else the player's IP city off Vercel's geo headers, never the data
  centre's. Request shaping is pure and unit-tested in `lib/pub-search.ts`;
  with no browser key the builder is list-only and nothing Google reaches
  the page.
- The react-hooks lint rules are strict (purity, no setState in effect
  body) — no `Date.now()` in render; `hooks/use-countdown.ts` is the
  sanctioned timer pattern (rAF before setInterval, null-initial state).
  For hydration guards use `useSyncExternalStore`, not a mounted effect.
- Cream is the default theme (it lives on `:root`, so there is no `.light`
  class to write); dark ("Midnight Invitational") is the opt-in, and
  `.theme-cream` re-asserts cream inside dark subtrees (the results recap).
  Engraving utilities: `rule-double`, `leader`, `engraved`.
- To-par renders as `−2 / +3 / even` (formatToPar) — never golf's lone "E".
- The mark is a **pint with a flagstick in it**, and it is artwork rather
  than code: the masters live in `public/brand/` (`icon-dark`, `icon-cream`,
  the 192/512 install sizes, `banner-dark`). Every surface reads one of
  them — `app/favicon.ico` (16/32/48), `app/apple-icon.png`, the manifest,
  and `HouseMark`, which renders the dark and cream plates and lets CSS pick
  so the swap costs no JavaScript and cannot flash the wrong one. The Open
  Graph cards read `assets/og-mark.png`, vendored beside the fonts on
  purpose: both are read off the filesystem at render time and only
  `assets/` is proven to reach the serverless bundle.
  Regenerate icons with `sharp` and **`.ensureAlpha()`** — Next's ICO
  decoder rejects a non-RGBA PNG, and `sips` writes RGB whenever the source
  has no alpha, which fails the build rather than the file.
  The manifest's `purpose: "maskable"` plate is the one icon that is
  generated rather than vendored: `node scripts/brand-maskable.mjs` bleeds
  the plate's own sampled ink to every edge and sets the squircle at 70% so
  the glass clears Android's 80% safe circle. Android masks icons into the
  launcher's shape, so without it every size above is letterboxed.
- The lockups (glass left, name right) are generated, not drawn:
  `node scripts/brand-lockups.mjs` writes `lockup-*` (transparent and
  `-stock`) and `letterhead-*` (tagline beneath) for both grounds into
  `public/brand/`, compositing the trimmed mark masters with the vendored
  EB Garamond via Satori — the same renderer as `lib/og.tsx`, so the
  letterforms match the OG cards. The wordmark is the sign-in masthead's
  voice verbatim (`app/signin/page.tsx` — serif, uppercase,
  `tracking-[0.08em]`, foreground ink, at whatever size that screen sets);
  change the voice there and these regenerate to follow, not the reverse.
- `lib/mark.ts` is now only the pennant geometry the `Putt` busy animation
  putts at — it stopped being the logo when the artwork arrived, and there
  is no static SVG copy left to pin against it.
- Open Graph cards live in `lib/og.tsx` (mirroring the `home` repo's module)
  and always render on **cream stock**, whatever the app theme, for the reason
  the recap card does: what you hand round is printed. Satori draws no
  `border: double`, no `outline` and no `box-shadow: inset`, so the engraving
  kit is rebuilt out of stacked divs. It also cannot use a CSS font stack —
  real TTFs are vendored in `assets/fonts/`.
- A card route must answer with an image even when its round does not exist;
  throwing there is a broken preview, not a 404. Round data comes from
  `get_round_card` (SECURITY DEFINER, anon-executable) because a crawler has
  no session — deliberately no player names and no scores, since the round
  routes redirect a signed-out visitor.
- Zero swigs = the drink never happened. On FILED holes computeStandings
  substitutes par (softSubstituteScoresPar, default) or double par (max
  score) — a 0 never scores as a free under-par hole. The in-progress hole
  only counts once swigs > 0. This still holds after a mulligan:
  resetting a hole never buys a free one.
- **The caddy never invents a pub.** It selects and orders from real Google
  Places results and dresses them (drink, par, hazard, local rules, course
  name). Enforced structurally rather than by instruction: the model only ever
  sees candidate *ids*, `applyDraftTool` refuses an id it was not given, and
  `parsePlan` resolves every id back against the dossier. It is also not a
  route planner — the walk is arithmetic's (`lib/caddy/route-graph.ts`), the
  model chooses between routes it is handed. A rule a unit test can hold does
  not belong in a prompt.
- Copy never mentions the machinery: "your night, planned in twenty seconds",
  never "AI-generated". Generated courses arrive as a **draft in the existing
  builder**, never as a finished card — the manual builder stays free and
  untouched, which is the covenant expressed as layout.
- **Money answers a refusal and never speaks first.**
  `tests/unit/covenant-money.test.ts` holds it: an allowlist of the modules
  that may render a price, which is two refusal sheets, `/tariff` and round
  creation. A price on a new screen has to be argued for in that list.
- The caddy's ceilings live in Postgres and its *courtesies* live in TypeScript
  — `liveFee` and `caddyAllowance` check the balance before the model is
  called, and the trigger is still the enforcement. When the ledger is
  mid-deploy both answer "yes", deliberately: refusing a paid host because a
  function is missing is the failure that branch keeps re-learning.
- The report-a-bug sheet files a GitHub issue on a **public** repository, so
  `lib/bug-report.ts` is the only thing that decides what may leave and is
  pure for exactly that reason. The load-bearing rule: **a round code never
  reaches the issue** — it is the join key, so a code on a public issue is an
  open door onto a live round. It is stripped from the route, from the
  player's own words, and from the title; the real code stays on the private
  `bug_reports` row and the issue carries only that row's id (no name, no uid,
  no email). Free text is printed inside a fence, which is what makes an
  `@everyone` inert. Both doors — the Profile screen and the round's rules
  sheet — go through `ReportBugSheet`; the parent owns both sheets so the
  rules close as the report opens rather than stacking.
- `rounds.ruleset` is read through `readRuleset` in `lib/ruleset.ts` and
  nowhere else — never re-cast the jsonb inline. It fills in defaults, so a
  round created before a rule existed reads as that rule being off.
- Three per-round rules ride on the ruleset snapshot: `penalties` (the house
  table), `mulligans`/`mulliganStrokes`, and `handicaps`. Mulligans were
  "breakfast balls" until the pre-launch rename (migration
  `20260813000000_mulligans`, deliberately non-additive) — if an old name
  resurfaces anywhere, it lost that rename, not a synonym. Holes
  carry their own `penalties` jsonb — local rules, merged after the house
  list by `penaltyOptions(ruleset, hole)` and deduped on `reason`, which is
  the join key for the undo and the ×N count.
- The green fee is a **day pass on its buyer**, not a line on a round:
  `entitlements` rows carry `round_id` null and
  `expires_at`, and what a round keeps is `members` in its own ruleset
  snapshot — stamped by `startRound` at tee-off, guarded by
  `guard_round_members` (false→true only, UPDATE only, only while
  `holds_day_pass(rounds.host)`). Covered stays covered: expiry and refunds
  never reach a round already teed off, and un-stamping raises 42501. Read
  the flag through `readRuleset`/`ruleset_members` — never a raw jsonb cast,
  and never the *string* `"true"`, which both sides agree is not the flag.
  The members' options group (`components/round/members-options.tsx`) lists
  `GREEN_FEE_EXTRAS`, which names only what has shipped.
- The phase-one funnel is two derived columns on `rounds`, not an events
  table: `finished_at` comes off the status transition and `recap_shares`
  moves only for `record_recap_share`, which announces itself with a
  transaction-local `pubgolf.recap_share` the way seat rescue does. Neither
  is writable by an official's ordinary update. `house_funnel` is
  `service_role` only.
- Handicaps come off gross to give **net**, and net is what the round is won
  on — `StandingRow` carries both, and ranking is on `netToPar`. They arrive
  pro rata (`handicap × holesPlayed / holes.length`) so the live board stays
  honest; that is the whole handicap once the card is filed. With every
  handicap at 0, net is gross and nothing on screen changes.

## Data model (supabase/migrations)

`game_types` → `rulesets` (reusable config) → `rounds` (snapshot ruleset,
join `code`, `hole_deadline_at` = the synced timer, `hole_phase`
live/walking + `walk_deadline_at` for the between-holes walk) → `holes`
(`venue_id` → `venues`, the shared Google Places cache), `round_players`
(host/caddy/player roles), `scores`, `penalties` (`called_by` attributes
marker entries). `courses`/`course_holes` are the builder's output,
owner-scoped. Guests use Supabase anonymous auth so RLS always keys on
`auth.uid()`; joining goes through the `join_round(code, name)` SECURITY
DEFINER function — which since the RLS hardening migration is the *only* way
into a round. The `round_players` INSERT policy allows exactly one direct
seat: the creator's own `role='host'` row, gated on `is_round_creator`, which
is what `createRound` writes between the round and the holes. The re-seat
flow that rule anticipated is **seat rescue** (`20260818000000`): a guest's
identity is one cookie jar, so when a phone loses it (in-app browsers,
mostly) the seat — where scores actually live — moves to the new session
rather than the session being resurrected. A seatless visitor on any round
route lands on `/round/CODE/rescue`; `request_seat_rescue` only *knocks*
(two nullable columns on the seat, so officials hear it over the
round_players realtime subscription they already hold), and
`approve_seat_rescue` — officials only, the caddy waves you in — is the one
sanctioned hand-change, let through the guard trigger by a transaction-local
`pubgolf.seat_rescue` setting nothing else sets. Only anonymous non-host
seats move (a claimed card signs back in with Google), a knocker already
seated is refused (strike the spare first), and `get_round_seats` — the one
surface that shows names to a non-member — is deliberately
authenticated-only, so a crawler with the link still reads no names
(`get_round_card` stays the nameless public path). The broom is the
`officials strike seats` DELETE policy (never the host seat): the struck
card's scores go on the cascade, penalties it *called* on others keep with
`called_by` nulled. `tests/db/rls-seat-rescue.test.ts` is the adversarial
suite; the rescue screen polls `get_round_seats` rather than subscribing,
because the knocker can't pass RLS until the moment they're waved in.
Roles are guarded by a `BEFORE UPDATE` trigger rather than a policy, because
`WITH CHECK` only sees NEW and "your role may not change" is about OLD. Two
more rules live in triggers for the same reason: `round_players.handicap` is
officials-only (a player editing their own passes the self policy, so only
OLD-vs-NEW can tell), and `scores.mulligans` is capped at the round's
allowance (a count across sibling rows, which WITH CHECK can never see).
A third — `guard_score_hole_window` — is the cheatproofing pass
(`20260814000000`): non-officials cannot write future holes, cannot lower a
filed hole, cannot lower the last hole once the card is filed, cannot
first-write a hole filed longer ago than one (the substitute stands), and
never take a mulligan off their own row. The **one-hole grace**
(`20260815000000`) is load-bearing, not a loophole: `advanceHole`
increments `current_hole` immediately while the play screen debounces swigs
by 400ms, so the hole directly behind the live one is the only hole an
honest late tap can be aimed at — refusing it silently scored that player
the par substitute while their own screen showed their swigs, and officials
never saw it because the guard exempts them. `penalties.strokes` is
schema-bounded 1..20 (a self-called −20 was a legal win), and penalty
retraction follows `called_by`, not whose card it sits on. All raise
`42501` so `expectDenied` recognises them; `tests/db/rls-cheatproofing.test.ts`
is the adversarial suite. `bug_reports` is the report screen's table and is
reporter-scoped in every direction — no official's view, because a report is
between the player and the club secretary. It carries three rules worth
knowing: the daily allowance is a trigger (`bug_report_daily_cap()`, mirrored
in `lib/bug-report.ts` and proved equal by a test) taking an advisory lock on
the reporter rather than `for update` on their profile row, since FOR UPDATE
would conflict with the FK's KEY SHARE lock and put reports in the way of
somebody joining a round; the issue is stamped back by the reporter's own
session, so the write is fenced by a **column grant** on
`(issue_number, issue_url)` and a USING clause of `issue_number is null` that
makes it one-way; and `anon` is granted nothing at all, so a signed-out
request gets the gate rather than a policy's empty list. Regenerate types after schema changes:
`supabase gen types typescript --local > types/database.ts`.

**The caddy** is four more tables and one rule that outranks all of them: it
never invents a pub. `caddy_sessions` (one conversation: the brief, the
`dossier` of real Places results, the `course_id` it filed) → `caddy_turns`
(one card each — a row exists only where a card arrived, which is the whole of
"nothing counts unless a card arrives"; carries the token counts and a `trace`
of the caddy's own tool *inputs*, never the replies, because a reply is mostly
Google's data). What a host may spend is a counted ledger: `caddy_grants`
(quota, amount, expiry) minus `caddy_spends`, read through `caddy_balance` and
`caddy_next_grant`. Three quotas — `course`, `redesign`, `tweak` — and a green
fee grants 1 / 4 / 60. Every enforcement is a trigger, never a policy, because
each is a count across sibling rows: `guard_caddy_spend` (the allowance),
`guard_caddy_fair_use` (80/day, anti-script armour above anything honest), and
`guard_caddy_course_slot` — **a host may keep as many caddy courses as they
have spent `course` credits**, which is the one-course-per-fee rule keyed on
what was bought rather than on the purchase row. `sweep_caddy_dossiers()` runs
hourly on pg_cron and is what makes the privacy notice's retention promise
true; the card it produced is never swept.

The green fee's day **starts at tee-off, not at purchase** (`activate_day_pass`,
`entitlements.activated_at`) — a null `expires_at` means dormant, not expired,
and every point-of-sale sentence has to say so. Three top-up SKUs sit above it
and never expire, because cost is incurred at redemption. A plan costs about
21p to serve, a roll 6p and a tweak 5p, so the worst a fee can cost — every
credit spent — is about £4 against £12 taken; `lib/caddy/budget.ts` carries
that arithmetic and `tests/unit/caddy-credits.test.ts` holds the rule that no
top-up may ever sell a card cheaper than the fee does.

Two hosted environments, both deployed by the platforms rather than from this
repo — Vercel's git integration builds the app, Supabase's GitHub integration
applies the migrations, and CI ships nothing (see `DEPLOYMENT.md`). `main` →
`pub-golf.glyn.dev` on `quncylgcwfiqsjugnvtv`; `preview` → the staging domain
on the persistent branch project `xssmjzinaghxjncoezez`. Because the two
integrations do not wait for each other, **migrations must be additive and
readable by the currently-deployed code** — PostgREST fails a whole request
with `42703` on a missing column, so a non-additive change is a visible outage
for the minute or two the deploy takes. `supabase/config.toml` stays
local-first and is never `config push`ed; the one thing that legitimately
reaches a hosted project is its `[remotes.preview]` block, which Configure
applies to the branch on every push. Anything added to `[auth]` for local dev
must be considered for that block too, or local and preview silently disagree.

Auth is **Google-only, and deliberately email-free**: hosting a round needs
a Google sign-in (`signInWithOAuth` → `/auth/callback` exchanges the PKCE
code), joining one needs nothing. Claiming a card is
`linkIdentity({provider:"google"})` on the anonymous uid, which keeps every
round already on it — that needs `enable_manual_linking`, off by default.
Never reintroduce an emailed code: Supabase's built-in sender refuses any
address outside the org team, so an email flow means Resend and a verified
domain before it works for a single real player. `handle_new_user` reads
`display_name`, then Google's `full_name`/`name`, before falling back.

Two doors, and the division of labour between them is load-bearing: `/` sells
(`components/landing.tsx` answers a signed-out visitor there, because Google's
brand verification grades that URL and wants the name, the purpose and the
privacy link on it), and `/signin` opens — mark, heading, the one line
`signInReason` derives from `next`, the button. Copy explaining what the app
*is* belongs on the landing page only; for one release it sat on both and the
two URLs read as the same page twice.

Walking state machine: `advanceHole` → phase `walking` (current_hole =
the upcoming hole, drink timer down); `teeUpHole` → phase `live` (timer
armed). `reopenHole(code, n)` is the only rewind. The marker's card roams
any hole via `/round/CODE/card?hole=N` without moving the round.

## Testing

`npm test` runs the Vitest `unit` project (`tests/unit/**`) — pure logic only:
scoring substitutions and placings (`lib/scoring.ts`), formatting, course
templates, walk estimates, penalty options, clock maths. **No stack, no
network, no clock** — every helper takes the time it needs as an argument, so
`lib/time.ts` is where countdown maths lives and `Date.now()` stays out of the
functions. Rules belong in the lowest layer that can hold them: if a browser is
proving something a function call could prove, it is in the wrong place.

`npm run test:db` runs the Vitest `db` project (`tests/db/**`) against the
local stack, driving Postgres with per-role supabase-js clients
(`tests/support/clients.ts`: `adminClient`, `signedInUser`, `anonymousGuest`,
`visitor`) and bypassing the server actions entirely. That is the point —
every action reaches Postgres through PostgREST on the caller's own session,
so **RLS is the only real enforcement** and `getOfficiatedRound` is a UX guard.
Fixtures come from `tests/support/factories.ts` and register themselves for an
`afterEach` scoped delete: **never `truncate`, never an unscoped `delete`** —
the Playwright suite uses the same stack minutes later. Two rules for this
tier: `adminClient()` is for seeding and reading a row back, never the subject
of a test; and an UPDATE that RLS filters out returns *no error and no rows*,
so a blocked write is proven by re-reading the row, never by `error === null`.

`adminClient()` drives PostgREST as `service_role`, so **a new table needs a
grant to `service_role` as well as `authenticated`** — this stack does not
auto-expose new tables to the Data API roles, and the whole db tier goes dark
the moment one is missed. Default privileges in
`20260811000000_service_role_grants.sql` cover tables a later migration
creates, but a table created by any other owner would still need it by hand.
Read the error shape: `42501 permission denied` is always the table grant; a
policy refusal returns no rows and no error at all.

`npm run test:stress` runs the Vitest `stress` project (`tests/stress/**`) —
the db tier turned up to a full table: twenty sessions on one round
(`tests/support/table.ts` seats them), the join stampede, the score storm,
the mulligan-allowance burst, and an eighteen-hole soak. Same stack, same
factories, same scoped teardown, same "re-read through adminClient, never
trust the response" rule; `retry: 0` for the same reason as db — a race that
shows one run in three is the tier's whole point. Setup goes through
`pooled()` (bounded fan-out) because arriving is not the experiment; the
moment under test uses bare `Promise.all` and says so. It found real bugs at
launch (the mulligan trigger's read-then-check let concurrent raises beat the
allowance — fixed by the seat lock in `20260816000000`), which is why it runs
in the PR gate, not on a schedule. It needs `[auth.rate_limit]
anonymous_users` raised in `config.toml` (local only, never preview): every
guest is an anonymous sign-in and gotrue's default 30/hour is under two
tables' worth.

The caddy's own logic is unit-tested and must stay that way: route order and
spacing (`lib/caddy/route.ts`, `route-graph.ts`), the tool reducer
(`lib/caddy/tools.ts`), candidate ids, the allowance arithmetic, the tariff's
ladder. **If a browser or a model is proving something a function call could
prove, it is in the wrong place** — the caddy is a curator and a tweaker, and
everything it is not deciding should be provable without it.

`npm run test:e2e` runs Playwright (port 3105) against the real local
Supabase stack, once per row of a platform matrix — Android Chrome
(Pixel 7), iOS Safari (iPhone 15/WebKit) and desktop Firefox — so
`npx playwright install chromium webkit firefox` once before the first run.
Two browser contexts play a full round in `round-flow`: create, guest join,
caddy promotion + controls (tee off, back/forward, reset timer, marker's
card edits, reopen), live score sync, results; `foursome` plays four phones
at once (stampede join, concurrent scoring, ties, the zero-swig substitute,
a latecomer joining a live round). The stack must be running
(`supabase start`), and `.env.local` needs `SUPABASE_SERVICE_ROLE_KEY`.
Multi-session Postgres races (join stampede, debounce vs marker collisions)
live in the db tier — `tests/db/multiplayer-concurrency.test.ts` — not here.

Host sessions are seeded by `e2e/auth.ts`, not driven through the UI —
Google's consent screen can't be automated. It creates a confirmed user with
the admin API, signs in for real tokens, and hands the cookies to the browser
context; `@supabase/ssr` does the serialization against an in-memory jar so
the cookie names and encoding always match what the app reads. The card-claim
step asserts the handoff to `/user/identities/authorize?provider=google`
with the request intercepted, rather than following it out to Google.

Gotchas already learned: seat the host in round_players BEFORE inserting
holes (RLS is_round_official); rounds SELECT policy needs `host =
auth.uid()` for INSERT..RETURNING; the realtime socket must carry the
user JWT (`supabase.realtime.setAuth`) or RLS silently filters all events;
after `supabase stop/start` or `db reset`, RESTART the dev server on 3105
(kill it and let Playwright respawn) or realtime events stop reaching
pages.

**A pass on retry is a failure.** CI sets `failOnFlakyTests`, so a test
that goes green on attempt two fails the run: retries are there to record
a trace (`trace: "on-first-retry"`), never to launder a red. This is not
pedantry — a "flaky" line once hid a real scoring bug, where swigs written
inside the hole-out debounce were refused and the hole silently scored the
par substitute, behind a green check. Assertions racing a realtime
`router.refresh()` are the usual suspect: Next mounts the outgoing and
incoming view together for a beat, so **counting a testid and then acting
on it must retry as one block** — `expectSettled`/`clickSettled` in
`e2e/nav.ts` do that with `toPass`; a bare `toHaveCount(1)` followed by a
separate `await` is the bug it looks like it prevents. In CI the suite
runs against `next start` (the build the job already made), so `CI=1
npx playwright test` after `npm run build` reproduces CI exactly.

## Local ports

Supabase local stack runs on 54330-54334 (offset from `home`'s 54320s so
both can run). Port 3000 is often held by Docker — use another port.
