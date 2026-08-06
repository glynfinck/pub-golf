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
- Zero swigs = the drink never happened. On FILED holes computeStandings
  substitutes par (softSubstituteScoresPar, default) or double par (max
  score) — a 0 never scores as a free under-par hole. The in-progress hole
  only counts once swigs > 0.

## Data model (supabase/migrations)

`game_types` → `rulesets` (reusable config) → `rounds` (snapshot ruleset,
join `code`, `hole_deadline_at` = the synced timer, `hole_phase`
live/walking + `walk_deadline_at` for the between-holes walk) → `holes`
(`venue_id` → `venues`, the shared Google Places cache), `round_players`
(host/caddy/player roles), `scores`, `penalties` (`called_by` attributes
marker entries). `courses`/`course_holes` are the builder's output,
owner-scoped. Guests use Supabase anonymous auth so RLS always keys on
`auth.uid()`; joining goes through the `join_round(code, name)` SECURITY
DEFINER function; claiming a card is `updateUser({email})` +
`verifyOtp(email_change)`. Regenerate types after schema changes:
`supabase gen types typescript --local > types/database.ts`.

Walking state machine: `advanceHole` → phase `walking` (current_hole =
the upcoming hole, drink timer down); `teeUpHole` → phase `live` (timer
armed). `reopenHole(code, n)` is the only rewind. The marker's card roams
any hole via `/round/CODE/card?hole=N` without moving the round.

## Testing

`npm run test:e2e` runs Playwright (Pixel 7 profile, port 3105) against the
real local Supabase stack — two browser contexts play a full round: OTP
sign-in via Mailpit's API, create, guest join, caddy promotion + controls
(tee off, back/forward, reset timer, marker's card edits, reopen), live
score sync, results. The stack must be running (`supabase start`).

Gotchas already learned: seat the host in round_players BEFORE inserting
holes (RLS is_round_official); rounds SELECT policy needs `host =
auth.uid()` for INSERT..RETURNING; the realtime socket must carry the
user JWT (`supabase.realtime.setAuth`) or RLS silently filters all events;
after `supabase stop/start` or `db reset`, RESTART the dev server on 3105
(kill it and let Playwright respawn) or realtime events stop reaching
pages — and expect the first e2e run after a cold stack boot to flake once
on the lobby realtime assertion; auth email templates
(`supabase/templates/*.html` + config.toml blocks for magic_link,
confirmation, email_change) must all carry `{{ .Token }}` — confirmations
are enabled locally to match production, so first sign-ins use the
confirmation template, not magic_link.

## Local ports

Supabase local stack runs on 54330-54334 (offset from `home`'s 54320s so
both can run). Port 3000 is often held by Docker — use another port.
