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

An additional project on this org costs **$10/month** (Pro plan compute).

```bash
supabase login                    # opens a browser
supabase projects create parlour --org-id qfabnyoyejsscqklyrmx \
  --region eu-central-1 --db-password "$(openssl rand -base64 24)"
```

Save that database password in your password manager — it becomes the
`SUPABASE_DB_PASSWORD` secret and cannot be read back.

`eu-central-1` matches the other two projects. Then apply the schema:

```bash
supabase link --project-ref <new-ref>
supabase db push                  # applies supabase/migrations/*
```

### 2. Supabase auth settings (the part that breaks quietly)

These are **not** applied by `db push`. Set them in the dashboard under
Authentication, or the guest flow fails in production while working perfectly
in local dev:

| Setting | Value | Why |
| --- | --- | --- |
| Allow anonymous sign-ins | **on** | Guests join rounds without an account; RLS keys on `auth.uid()`. Off ⇒ nobody can join. |
| Site URL | `https://pub-golf.glyn.dev` | Confirmation/claim links |
| Redirect URLs | `https://pub-golf.glyn.dev/**` | Plus any preview origins you want to allow |
| Confirm email | **on** | Claiming a card must require the emailed code, not autoconfirm |

Then copy the three email templates from `supabase/templates/` into
Authentication → Email Templates — **magic link**, **confirm signup**, and
**change email address**. Each must contain `{{ .Token }}`: the app signs in
with a 6-digit code, so a template that only carries `{{ .ConfirmationURL }}`
gives users a link that does not complete the flow.

> Do **not** run `supabase config push`. It would overwrite the production
> `site_url` with `http://localhost:3105` from `config.toml`, which is
> local-first by design.

### 3. Custom SMTP — required, not optional

Supabase's built-in email sender is rate-limited to a handful of messages per
hour and is only intended for testing. Parlour sends an email *per sign-in*
and *per card claim*, so at a real event with a dozen players the default
sender will start dropping messages within the first minute.

Configure a real provider under Authentication → SMTP Settings before the
first round. [Resend](https://resend.com) is the usual pick for this stack
(free tier covers 3k/month; verify `glyn.dev` and send as
`parlour@glyn.dev`). Raise the auth rate limit for emails once SMTP is on.

### 4. Vercel project

Import `glynfinck/pub-golf` at
[vercel.com/new](https://vercel.com/new) into the **glynfinck's projects**
team. Framework preset auto-detects as Next.js; leave build settings alone.

Environment variables (Production **and** Preview):

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API → publishable key |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Cloud; restrict to `pub-golf.glyn.dev/*` |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | Google Cloud styled map ID |
| `GOOGLE_PLACES_API_KEY` | Server-only. **Never** `NEXT_PUBLIC`. Application restriction must be *None* or *IP addresses* — a website restriction blocks server-side calls |

The two Google keys are optional; without them the course builder degrades to
add-by-name, which still works.

### 5. Domain

`glyn.dev` already uses Vercel nameservers (`ns1/ns2.vercel-dns.com`), so
adding the domain in Vercel → Project → Settings → Domains creates the DNS
record automatically. Add `pub-golf.glyn.dev`; no registrar changes needed.

### 6. GitHub secrets

Settings → Secrets and variables → Actions:

| Secret | Where to get it |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF` | The new project's ref |
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
