# Pub Golf

Mobile-first PWA for social bar-crawl games. Pub Golf is the flagship game:
nine pubs, park to park, order the club listed for the hole, count every
swallow — your swigs are your score. Lowest total wins.

Pub Golf is the app; the
platform will eventually carry other curated and custom game formats.

## Stack

- **Next.js 16** (App Router, Turbopack) on **Vercel**
- **Supabase** — Google sign-in for hosts, anonymous guest auth for
  everyone else, Postgres with RLS, Realtime for lobby presence and live
  scores. No email anywhere in the auth path: starting a round takes one
  tap, joining one takes a code and nothing else.
- **Tailwind CSS 4** with the Invitational house style (cream stock,
  fairway green, orange markers) as design tokens in `app/globals.css`
- **Google Maps Platform** (planned) — Places for pub ratings, a
  cloud-styled map ID for the themed course map

## Develop

```sh
npm install
cp .env.example .env.local   # fill in values from `supabase start`
supabase start               # local stack on ports 54330-54334
npm run dev
```

Note: port 3000 is often occupied by Docker on this machine — `next dev`
will pick the next free port, or pass `-p`.

`npm run lint`, `npm run typecheck`, `npm run build` should all stay green.
`npm run test:e2e` plays a full two-phone round against the local stack.

## Deploy

Production is [pub-golf.glyn.dev](https://pub-golf.glyn.dev), on Vercel with
a dedicated hosted Supabase project. Pushing to `main` runs CI, which
verifies, then migrates production, then deploys — in that order, so the app
never boots against a schema that has not landed yet. See
[DEPLOYMENT.md](DEPLOYMENT.md).

## Design

The visual direction (nine screen mockups, interactive styled map, naming
study, research-sourced UX patterns) lives in the design artifact:
https://claude.ai/code/artifact/ce90666d-1c03-46af-a524-0aa336658198

Key decisions: synced hole timers are a single `hole_deadline_at`
timestamp that every client counts down to locally; joining is
code + name with no account (Kahoot/Jackbox pattern, backed by Supabase
anonymous auth); the caddy role holds host-level powers during play.
