# Deploying Parlour

Production is **pub-golf.glyn.dev** — Vercel for the app, a dedicated hosted
Supabase project for Postgres/Auth/Realtime, GitHub Actions as the release
pipeline. This mirrors `graph-editor` and `home`, with one deliberate
difference: **the app deploys only after migrations have applied** (see
[Release ordering](#release-ordering)).

## Why not the Vercel↔Supabase marketplace integration

The Vercel marketplace integration exists mainly to provision a Supabase
project *through Vercel* (Vercel becomes the biller) and to sync
`NEXT_PUBLIC_SUPABASE_*` into the project's environment variables. It is a
good fit for a brand-new project with no Supabase account.

It is the wrong fit here:

- The Supabase org is already on **Pro**, with `Graph Editor` and `Home`
  billed there. Provisioning through Vercel splits billing across two vendors
  and moves this one project outside the org you actually manage.
- Migrations are driven by the Supabase CLI from GitHub Actions. The
  integration does not run migrations, so it solves none of the hard part.
- It syncs env vars *into* Vercel, which is three values you set once and
  never touch again.

The convention for this stack — CLI-managed migrations, Vercel for hosting —
is to keep the two accounts separate and wire three environment variables by
hand. That is what the rest of this document does.

## Release ordering

`vercel.json` disables Vercel's git auto-deploy for `main`:

```json
{ "git": { "deploymentEnabled": { "main": false } } }
```

Without this, pushing to `main` triggers a Vercel build **in parallel** with
the GitHub Actions run — so new code can go live seconds before (or instead
of) its migration, serving production against an old schema. With it, `main`
has exactly one path to production, and it is ordered:

```
verify  →  migrate  →  deploy
(lint, typecheck,     (supabase   (vercel build
 build, e2e vs.        db push)    + deploy --prod)
 a real local
 Supabase)
```

Any job failing stops the ones after it: a red test never migrates, and a
failed migration never deploys.

Preview deploys for non-`main` branches still run through Vercel's git
integration as usual — `deploymentEnabled` is scoped to `main` only.

Because migrations land *before* the new code, migrations must be
backward-compatible with the currently-deployed release for the length of a
deploy (a minute or two). Additive changes are always safe. For a destructive
change (dropping or renaming a column the live app still reads), use
expand/contract: ship the additive migration and the code that tolerates both
shapes first, then drop the old column in a later release.

## One-time setup

### 1. Supabase production project

Already created — **Pub Golf**, ref `quncylgcwfiqsjugnvtv`, region
`eu-west-2`, at `https://quncylgcwfiqsjugnvtv.supabase.co`. It bills at
$10/month on the Pro org.

Apply the schema:

```bash
supabase login                    # opens a browser
supabase link --project-ref quncylgcwfiqsjugnvtv
supabase db push                  # applies supabase/migrations/*
```

CI does this on every push to `main` once the secrets are in place (step 6);
this first run is only to get the schema in before the first deploy. Keep the
database password from project creation — it is the `SUPABASE_DB_PASSWORD`
secret and cannot be read back.

### 2. Supabase auth settings (the part that breaks quietly)

These are **not** applied by `db push`. Set them in the dashboard under
Authentication, or the guest flow fails in production while working perfectly
in local dev:

| Setting | Value | Why |
| --- | --- | --- |
| Google provider | **enabled**, with the client ID/secret from step 3 | The only way to sign in |
| Allow anonymous sign-ins | **on** | Guests join rounds without an account; RLS keys on `auth.uid()`. Off ⇒ nobody can join. |
| Allow manual linking | **on** | "Claim your card" links Google to an anonymous uid. Off by default; the claim button fails without it. |
| Email provider | **off** | Nothing in the UI reaches it. Leaving it on is a signup path nobody uses. |
| Site URL | `https://pub-golf.glyn.dev` | Where OAuth returns to |
| Redirect URLs | `https://pub-golf.glyn.dev/**` | Plus any preview origins you want to allow |

> Do **not** run `supabase config push`. It would overwrite the production
> `site_url` with `http://localhost:3105` from `config.toml`, which is
> local-first by design — and it would re-enable the email provider, which
> local keeps on only so the e2e suite can seed sessions.

**There is no SMTP to configure, and that is the point.** Hosts sign in with
Google and guests join anonymously, so the app never sends an email. This is
worth protecting: the moment any flow goes back to emailing users, Supabase's
built-in sender *refuses to deliver to anyone outside your org's team*, and
you would need Resend plus a verified domain before that flow works at all.

### 3. Google OAuth client

In Google Cloud → APIs & Services → Credentials, create an **OAuth client ID**
of type *Web application*, and configure the consent screen as External.

Authorized redirect URIs — Supabase handles the callback, not the app, so
these point at Supabase:

| Environment | URI |
| --- | --- |
| Production | `https://quncylgcwfiqsjugnvtv.supabase.co/auth/v1/callback` |
| Local dev | `http://127.0.0.1:54331/auth/v1/callback` |

Put the client ID and secret into the Supabase dashboard for production, and
into `.env.local` as `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` /
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` for local (`supabase start` reads them
through `config.toml`). Local dev also needs `skip_nonce_check`, which is
already set.

While the consent screen is in *Testing*, only accounts on its test-user list
can sign in — publish it before letting anyone else host a round.

### 4. Vercel project

Import `glynfinck/pub-golf` at
[vercel.com/new](https://vercel.com/new) into the **glynfinck's projects**
team. Framework preset auto-detects as Next.js; leave build settings alone.

Environment variables (Production **and** Preview):

Required:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://quncylgcwfiqsjugnvtv.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API → publishable key (`sb_publishable_…`) |

Optional — improves the course builder, nothing breaks without it:

| Variable | Where it comes from |
| --- | --- |
| `GOOGLE_PLACES_API_KEY` | Server-only. **Never** `NEXT_PUBLIC`. Application restriction must be *None* or *IP addresses* — a website restriction blocks server-side calls |

Without it, pub search degrades to add-by-name, which builds a perfectly
good course.

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` are
placeholders in `.env.example` for the themed course map, which is not built
yet — **no code reads either one**. Skip them until there is a map to style.

### 5. Domain

`glyn.dev` already uses Vercel nameservers (`ns1/ns2.vercel-dns.com`), so
adding the domain in Vercel → Project → Settings → Domains creates the DNS
record automatically. Add `pub-golf.glyn.dev`; no registrar changes needed.

### 6. GitHub secrets

Settings → Secrets and variables → Actions:

| Secret | Where to get it |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF` | `quncylgcwfiqsjugnvtv` |
| `SUPABASE_DB_PASSWORD` | The password from step 1 |
| `VERCEL_TOKEN` | vercel.com/account/tokens |
| `VERCEL_ORG_ID` | `team_efHn4CGsL2iT0Xmp3qdWG9d2` |
| `VERCEL_PROJECT_ID` | Vercel → Project → Settings → General (or `.vercel/project.json` after `vercel link`) |

Both the `migrate` and `deploy` jobs guard on their secrets and skip with a
notice if they are missing, so CI stays green while you work through this
list. `deploy` skipping is a **warning** in the run summary — if a push to
`main` did not reach production, check there first.

## Day-to-day

Push to `main`. CI verifies, migrates, then deploys. Nothing else to do.

Rolling back app code is a Vercel instant rollback to the previous
deployment. Rolling back a migration is a new forward migration — never edit
an applied one, since `db push` tracks them by version.

After any schema change, regenerate types:

```bash
supabase gen types typescript --local > types/database.ts
```
