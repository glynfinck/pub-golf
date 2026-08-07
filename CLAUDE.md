# Parlour (pub-golf)

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
- The react-hooks lint rules are strict (purity, no setState in effect
  body) — no `Date.now()` in render; `hooks/use-countdown.ts` is the
  sanctioned timer pattern (rAF before setInterval, null-initial state).
  For hydration guards use `useSyncExternalStore`, not a mounted effect.
- Dark ("Midnight Invitational") is the default theme; cream is the light
  theme, and `.theme-cream` re-asserts it inside dark subtrees (the results
  recap). Engraving utilities: `rule-double`, `leader`, `engraved`.
- To-par renders as `−2 / +3 / even` (formatToPar) — never golf's lone "E".
- The house mark (pennant, flagstick, green) has one definition in
  `lib/mark.ts`. `ParlourMark` inks it with the semantic tokens; the favicon
  and the generated images take literals, because neither an icon file nor
  Satori can resolve a `var()`. `app/icon.svg` is the one copy that cannot
  import it and is pinned to `markSvg(32)` by `tests/unit/mark.test.ts` —
  regenerate the file rather than hand-editing it.
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
is what `createRound` writes between the round and the holes. Any future
re-seat or rejoin flow needs a SECURITY DEFINER function, not a client insert.
Roles are guarded by a `BEFORE UPDATE` trigger rather than a policy, because
`WITH CHECK` only sees NEW and "your role may not change" is about OLD. Two
more rules live in triggers for the same reason: `round_players.handicap` is
officials-only (a player editing their own passes the self policy, so only
OLD-vs-NEW can tell), and `scores.mulligans` is capped at the round's
allowance (a count across sibling rows, which WITH CHECK can never see).
Both raise `42501` so `expectDenied` recognises them. Regenerate types after schema changes:
`supabase gen types typescript --local > types/database.ts`.

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
pages — and expect the first e2e run after a cold stack boot to flake once
on the lobby realtime assertion.

## Local ports

Supabase local stack runs on 54330-54334 (offset from `home`'s 54320s so
both can run). Port 3000 is often held by Docker — use another port.
