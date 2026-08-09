<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/mark-dark.png">
    <img src="public/brand/mark-cream.png" alt="Pub Golf — a pint glass with a flagstick sunk in it" width="160">
  </picture>
</p>

<h1 align="center">Pub Golf</h1>

<p align="center">
  Nine pubs, park to park. Order the club listed for the hole,<br>
  count every swallow — your swigs are your score. Lowest total wins.
</p>

<p align="center">
  <a href="https://pub-golf.glyn.dev"><strong>pub-golf.glyn.dev</strong></a>
</p>

---

A mobile-first web app for playing pub golf on real phones in real pubs.
One player hosts with a Google sign-in; everyone else joins with a
six-character code and a name — no account, no email, nothing to install.
The card is shared and live: swigs, penalties, mulligans and the hole
timer land on every phone in the round as they happen.

The default card is the Glyn Invitational — nine pubs, par 36, London
Fields up to Finsbury Park — but a round is anything from 1 to 18 holes,
on that template, that template reversed, or a course you built yourself.

## How a round plays

**Create.** The host signs in with Google and sets the card: course (the
template, forwards or reversed, or one of their own), hole count, format,
minutes per pub, and which house rules are on — hazards, a hole timer,
penalties, mulligans, handicaps. All of it is snapshotted into
`rounds.ruleset` at creation, so editing a rule later never rescores a
round already played.

**Join.** Everyone else opens the link or types the code — six characters
from a 32-character alphabet with `0/O/1/I` removed — picks a name, and is
in. That is a Supabase anonymous sign-in behind the scenes, so a guest is
a real authenticated user with their own row-level permissions from the
first tap. A guest can claim their card with Google afterwards and keep
every round already on it.

**Play.** Each hole is one screen: the pub, the drink, the hazard, your
swig counter, one-tap penalties. Scores are written per player per hole,
so the leaderboard ranks on score-to-par over the holes each player has
actually recorded — a golf leaderboard mid-tournament, not a table of
totals that punishes whoever is behind.

**Walk.** Between holes the round enters a walking phase — `advanceHole`
moves to the next pub and starts the walk, `teeUpHole` arms the drink
timer when the group is stood there. When the host has put a timer on the
card, it is one `hole_deadline_at` timestamp that every client counts
down to locally, so every phone reads the same second without a heartbeat.

**Officials.** The host can promote a caddy, who holds the same controls:
tee off, rewind a hole, reset the timer, set handicaps and mulligan
allowances, strike a seat. Any official can roam the marker's card at
`/round/CODE/card?hole=N` and fix any hole without moving the round.

**File.** Results are a printed card: podium, the full scorecard, gross
and net, superlatives, and a recap panel drawn on cream stock whatever
theme the app is in — it exists to be screenshotted into the group chat.
Round links carry Open Graph cards rendered server-side (nameless and
scoreless, because a crawler has no session), and the host can save the
course they just played or start the rematch — "the Glyn Invitational
XXX" hosts XXXI.

**Lose your seat, get it back.** A guest's identity is one cookie jar, and
in-app browsers drop it. A seatless visitor on a round route lands on
`/round/CODE/rescue` and knocks; an official waves them in and the seat —
where the scores actually live — moves to the new session. It is the one
sanctioned hand-change, and only for anonymous non-host seats.

## Scoring, and why it can't be gamed

- **Zero swigs is not a free hole.** A filed hole with no drink recorded
  scores the substitute — par by default, double par at the strict
  setting. Resetting a hole with a mulligan doesn't buy one either.
- **Net is what the round is won on.** Handicaps come off gross, pro rata
  to the holes played, so the live board stays honest all night instead of
  putting a six-handicap six under before they've drunk anything.
- **Penalties are attributed.** A penalty knows who called it, which is
  what the undo and the ×N count key on, and what survives when the seat
  that called it is struck.
- **Postgres holds the rules, not the client.** Every write reaches
  Postgres through PostgREST on the caller's own session, so RLS and
  triggers are the real enforcement and the server actions are a UX guard.
  Non-officials cannot write future holes, lower a filed hole, lower the
  last hole after the card is filed, first-write a hole filed longer ago
  than one, take a mulligan off someone else's row, or exceed the round's
  mulligan allowance. Penalty strokes are schema-bounded 1..20 — a
  self-called −20 was a legal win once. `tests/db/rls-cheatproofing.test.ts`
  and `tests/db/rls-seat-rescue.test.ts` are the adversarial suites.

## The course builder

`/courses/new` builds a course from real pubs. Search is a server-proxied
Google Places (New) call — the key never reaches the browser — aimed at
the map's viewport when there is one, else at the player's IP city off
Vercel's geo headers, never the data centre's. Results are cached in a
shared `venues` table, so a round never needs Google again after build
time. Each hole gets a drink, a par, an optional hazard and up to five
local rules; walks between pubs are estimated from the coordinates.

The map sheet is a cloud-styled Google vector map wearing the house
theme: one map ID holding cream in its light slot and Midnight in its
dark slot, with `colorScheme` picking the variant and the app drawing its
own pins. Both style masters are vendored in `docs/map-styles/`.

Both Google keys are optional. Without the browser key the builder is
list-only and nothing Google reaches the page; without the server key it
degrades to add-by-name, which still works.

## Reporting a bug

Every screen has a door onto the report sheet: one on the Profile screen
beside the build stamp, and one at the foot of a round's rules sheet — the
sheet a player already opens when the app is not doing what they expected.
A report filed from inside a round arrives knowing the hole, the phase and
the build, so nobody has to remember any of it.

A report becomes an issue on this repository's **public** tracker, and the
sheet says so before the thumb reaches Send. What never leaves is anything
that identifies the reporter: no name, no id, and above all no round code —
a code is the join key, so a code on a public issue is an open door onto a
live round. The code stays on the private `bug_reports` row, the issue
carries that row's id, and `lib/bug-report.ts` is where the redaction is
written and unit-tested.

The row is written before GitHub is called, which is what makes five
reports a day a number Postgres enforces rather than a number a serverless
function hopes for, and what keeps a report when GitHub is unreachable.
Staging carries the token too, so the GitHub half is exercised before it
reaches players. Those issues are real but never anonymous about it: any
deployment Vercel does not call `production` files under a `[preview]`
title with "Not production — safe to close or delete" as the first line of
the body, so `is:issue "[preview]"` sweeps a testing session up in one go.

Without `GITHUB_ISSUE_TOKEN` the feature still takes reports — they simply
stay on the table until somebody reads them:

```sql
select id, area, body, round_code, created_at
  from bug_reports where issue_number is null order by created_at desc;
```

## Stack

- **Next.js 16** (App Router, Turbopack, React 19) on **Vercel**.
  `proxy.ts` is this version's middleware convention.
- **Supabase** — Google sign-in for hosts, anonymous auth for guests,
  Postgres with RLS on every table, Realtime for live scores
  (`postgres_changes`) and lobby presence. No email anywhere in the auth
  path: joining needs nothing, hosting needs Google, claiming a card is
  `linkIdentity` on the anonymous uid.
- **Tailwind CSS 4** with the Invitational house style — cream stock,
  fairway green, orange markers — as design tokens in `app/globals.css`,
  plus the opt-in dark "Midnight Invitational". Components are
  **shadcn/ui**; the domain pieces (chips, hazard pills, countdown ring,
  dot leaders) are custom.
- **Google Maps Platform** — Places (New) server-side for pub search and
  ratings, Maps JavaScript API for the builder's map sheet.
- **Vitest** and **Playwright** for the four test tiers below.

## Repo map

| Path | What's in it |
| --- | --- |
| `app/` | Routes. `(tabs)` is the signed-in shell; `round/[code]` is lobby, play, marker's card, results, rescue; `api/places/search` proxies Google. |
| `components/round/` | The card itself — lobby, play, walking, results, penalty and mulligan sheets. |
| `components/course/` | The builder: place search, hole editor, map sheet. |
| `lib/actions/` | Server actions. Every one of them ends up at PostgREST on the caller's session. |
| `lib/scoring.ts` | Standings, substitutions, handicaps, placings. Pure. |
| `lib/bug-report.ts` | What a bug report may say once it leaves for a public tracker. Pure, and the redaction is the point. |
| `lib/ruleset.ts` | The one door onto `rounds.ruleset`. Never re-cast the jsonb inline. |
| `lib/og.tsx` | Open Graph cards, rendered by Satori on vendored fonts. |
| `supabase/migrations/` | Schema, RLS policies, triggers, SECURITY DEFINER functions. |
| `tests/`, `e2e/` | Unit, database, stress, Playwright. |
| `CLAUDE.md` | The long version of every convention here. |
| `DEPLOYMENT.md` | How the two hosted environments are wired. |

## Develop

Needs Node 22+ (`@supabase/supabase-js` wants a native WebSocket), the
Supabase CLI, and Docker running.

```sh
npm install
supabase start               # local stack on ports 54330-54334
cp .env.example .env.local   # fill in the values `supabase start` prints
npm run dev
```

`.env.example` documents every variable and what breaks without it. The
Google keys are all optional for local work; `SUPABASE_SERVICE_ROLE_KEY`
is only ever read by the test suites.

Port 3000 is often held by Docker — `next dev` will pick the next free
port, or pass `-p`.

`npm run lint`, `npm run typecheck` and `npm run build` should all stay
green.

## Test

Four tiers; every rule lives in the lowest layer that can hold it. All
four run in the PR gate.

| Command | What it proves |
| --- | --- |
| `npm test` | Pure logic — scoring substitutions, placings, formatting, clock and walk maths. No stack, no network, no clock. |
| `npm run test:db` | RLS, triggers and RPCs, driven straight through PostgREST with per-role clients. RLS is the only real enforcement, so the adversarial suites live here. |
| `npm run test:stress` | The db tier at full-table scale — twenty sessions on one round, the join stampede, the score storm, the mulligan-allowance burst, an eighteen-hole soak. |
| `npm run test:e2e` | Playwright plays full multi-phone rounds on Android Chrome, iOS Safari and desktop Firefox. |

The db, stress and e2e tiers need the local stack running
(`supabase start`) and `.env.local` filled in; e2e also needs
`npx playwright install chromium webkit firefox` once. `npm run test:all`
runs the three Vitest projects together.

A pass on retry counts as a failure: CI sets `failOnFlakyTests`, because
a "flaky" line once hid a real scoring bug behind a green check.

## Deploy

Production is [pub-golf.glyn.dev](https://pub-golf.glyn.dev); staging is
the `preview` branch, a mirror of `main` on its own Supabase branch
project. Both are deployed by the platforms, not from this repo: Vercel's
git integration builds the app, Supabase's GitHub integration applies the
migrations, and CI runs `verify` and ships nothing — branch protection on
that check is what gates a release. Because the two integrations don't
wait for each other, **migrations must stay additive and readable by the
currently-deployed code**: PostgREST fails a whole request on a missing
column, so a non-additive change is a visible outage for the length of a
deploy. The full story, including the auth settings that break quietly,
is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Not built yet

Stated plainly, because the UI offers some of it:

- **Stableford, match and scramble** are selectable at creation and
  stored on the ruleset, but every screen scores stroke play. Picking one
  changes the label on the card and nothing else.
- **No offline play.** There's a web app manifest, icons and a standalone
  display mode, so it installs to a home screen — but there is no service
  worker, so a pub with no signal is a pub with no scorecard.
- **No push notifications**, so "you're up" only reaches a phone that is
  already looking at the round.

## Design

The house style is documented where it is enforced: tokens in
`app/globals.css`, conventions in [CLAUDE.md](CLAUDE.md). The mark is a
pint with a flagstick in it; the masters live in `public/brand/`, and the
lockups and letterheads are generated by `node scripts/brand-lockups.mjs`
from the same Satori renderer that draws the Open Graph cards, so the
letterforms match.

Three decisions worth stating up front, because everything else follows
from them: joining is code + name with no account (the Kahoot/Jackbox
pattern, backed by Supabase anonymous auth); the synced hole timer is a
single timestamp every client counts down to locally; and the caddy holds
host-level powers during play, because the person holding the phone is
not always the person who booked it.
