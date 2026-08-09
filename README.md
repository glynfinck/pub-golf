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

A mobile-first PWA for playing pub golf on real phones in real pubs.
One player hosts with a Google sign-in; everyone else joins with a
four-letter code and a name — no account, no email, nothing to install.
The card is shared and live: scores, penalties and the synced hole timer
update on every phone in the round as they happen.

## How a round plays

- **Join by code** — the Kahoot/Jackbox pattern, backed by Supabase
  anonymous auth. Guests can claim their card with Google afterwards and
  keep every round already on it.
- **Synced hole timers** — one `hole_deadline_at` timestamp that every
  client counts down to locally, with a walking phase between holes.
- **Roles** — the host can promote a caddy with full controls (tee off,
  rewind, reset the timer) and any official can roam the marker's card
  to edit any hole without moving the round.
- **House rules on a snapshot** — penalties, mulligans and handicaps ride
  on the round's ruleset; the live board shows gross and net, and net is
  what the round is won on.
- **Cheatproofing in Postgres** — every write goes through RLS and
  triggers on the caller's own session, so the rules hold even against a
  hand-rolled client. `tests/db/rls-cheatproofing.test.ts` is the
  adversarial suite.

## Stack

- **Next.js 16** (App Router, Turbopack) on **Vercel**
- **Supabase** — Google sign-in for hosts, anonymous guest auth for
  everyone else, Postgres with RLS, Realtime for lobby presence and live
  scores. No email anywhere in the auth path.
- **Tailwind CSS 4** with the Invitational house style — cream stock,
  fairway green, orange markers — as design tokens in `app/globals.css`,
  and a dark "Midnight Invitational" theme as the opt-in.
- **Google Maps Platform** — server-proxied Places (New) search for the
  pubs and their ratings, and the course builder's map sheet on a
  cloud-styled vector map that wears the house theme (cream and Midnight
  map IDs).

## Develop

```sh
npm install
cp .env.example .env.local   # fill in values from `supabase start`
supabase start               # local stack on ports 54330-54334
npm run dev
```

Note: port 3000 is often occupied by Docker on this machine — `next dev`
will pick the next free port, or pass `-p`.

`npm run lint`, `npm run typecheck` and `npm run build` should all stay
green.

## Test

Four tiers; every rule lives in the lowest layer that can hold it:

| Command | What it proves |
| --- | --- |
| `npm test` | Pure logic — scoring substitutions, placings, formatting, clock maths. No stack, no network, no clock. |
| `npm run test:db` | RLS and triggers, driven through PostgREST with per-role clients. RLS is the only real enforcement, so the adversarial suite lives here. |
| `npm run test:stress` | The db tier at full-table scale — twenty sessions on one round, the join stampede, the mulligan-allowance burst. |
| `npm run test:e2e` | Playwright plays full multi-phone rounds on Android Chrome, iOS Safari and desktop Firefox. |

The db, stress and e2e tiers need the local stack running
(`supabase start`) and `.env.local` filled in; e2e also needs
`npx playwright install chromium webkit firefox` once.

## Deploy

Production is [pub-golf.glyn.dev](https://pub-golf.glyn.dev); staging is
the `preview` branch, a mirror of `main` on its own Supabase branch
project. Both are deployed by the platforms, not from this repo: Vercel's
git integration builds the app, Supabase's GitHub integration applies the
migrations, and CI runs `verify` and ships nothing — branch protection on
that check is what gates a release. Because the two integrations don't
wait for each other, migrations must stay additive and readable by the
currently-deployed code. The full story, including the auth settings that
break quietly, is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Design

The visual direction (nine screen mockups, interactive styled map, naming
study, research-sourced UX patterns) lives in the design artifact:
https://claude.ai/code/artifact/ce90666d-1c03-46af-a524-0aa336658198

Key decisions: synced hole timers are a single `hole_deadline_at`
timestamp that every client counts down to locally; joining is
code + name with no account (Kahoot/Jackbox pattern, backed by Supabase
anonymous auth); the caddy role holds host-level powers during play.
