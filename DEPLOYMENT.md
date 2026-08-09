# Deploying Pub Golf

Two environments, both deployed by the platforms themselves:

| | Branch | App | Database |
| --- | --- | --- | --- |
| Production | `main` | **pub-golf.glyn.dev** | `quncylgcwfiqsjugnvtv` |
| Staging | `preview` | **pub-golf-preview.glyn.dev** | branch project `xssmjzinaghxjncoezez` |

## Who deploys what

Nothing in this repo ships anything. Push to a release branch and two
integrations react to it independently:

- **Vercel's git integration** builds and deploys the app. `main` goes to
  production, `preview` to the staging domain, every other branch to a
  throwaway preview URL.
- **Supabase's GitHub integration** applies `supabase/migrations/*`. `main`
  deploys to the production project; `preview` deploys to its own branch
  project, and also applies `[remotes.preview]` from `config.toml`.

There is no `vercel.json` and there are **no GitHub Actions secrets**. CI runs
`verify` and nothing else.

### What that costs, stated plainly

This is the deliberate trade against an earlier design where GitHub Actions
owned an ordered `verify → migrate → deploy` chain. Two properties were given
up for a pipeline with no credentials in it:

**The two integrations race.** Vercel builds in roughly 60–90 seconds;
Supabase's branch deploy waits up to 2 minutes on a health check before it
even migrates. So there is a window — call it 1–5 minutes — where new code is
live against the old schema. That is not subtle here: PostgREST answers a
select on a missing column with `42703` and fails the whole request, so the
round page, the marker's card and the recap all 500 until the migration lands.

The mitigation is discipline, not machinery: **migrations must be additive and
backward-compatible with the currently-deployed release.** For a destructive
change (dropping or renaming a column the live app still reads), use
expand/contract — ship the additive migration and code that tolerates both
shapes first, then drop the old column in a later release.

**A deploy is not gated on tests.** Vercel builds whether or not CI is green.
The thing that puts the test gate back is **branch protection**: require the
`verify` check on `main` and `preview`, so the only way to reach a release
branch is a merge that passed. Without that, this is a repo where a red suite
ships itself. Set it up before relying on either environment.

## Why not the Vercel↔Supabase marketplace integration

Even going native for deploys, **do not install it.** It exists mainly to
provision a Supabase project *through Vercel* (Vercel becomes the biller) and
to sync `NEXT_PUBLIC_SUPABASE_*` into Vercel's environment variables.

- The Supabase org is already on **Pro**, with `Graph Editor` and `Home`
  billed there. Provisioning through Vercel splits billing across two vendors.
- It does not run migrations — Supabase's *GitHub* integration does that, and
  it is already installed. The marketplace one solves none of the hard part.
- It syncs env vars into Vercel at pull-request-open time and re-deploys to
  beat its own race. That makes it a second, invisible writer to the one pair
  of values whose wrongness is catastrophic (see the Preview table below), and
  `preview` is a long-lived branch, not a PR, so it would not fire for it
  anyway.

Four env vars per environment, set by hand, is the whole job.

## One-time setup

### 1. Supabase production project

Already created — **Pub Golf**, ref `quncylgcwfiqsjugnvtv`, region
`eu-west-2`, at `https://quncylgcwfiqsjugnvtv.supabase.co`. It bills at
$10/month on the Pro org.

Migrations reach it through **Supabase's GitHub integration**, which must be
connected to `glynfinck/pub-golf` with:

- **Production branch** = `main`. This is the setting to check first when
  production falls behind: with it unset, pushes to `main` migrate nothing and
  no error is raised anywhere. The symptom is `list_branches` showing the
  production branch with no `git_branch` field and an `updated_at` that never
  moves.
- **Supabase directory** = `supabase`.
- Branching enabled, which is what creates the `preview` branch project.

To apply migrations by hand — for a first run, or to catch a project up:

```bash
supabase login                    # opens a browser
supabase link --project-ref quncylgcwfiqsjugnvtv
supabase db push                  # applies supabase/migrations/*
```

Keep the database password from project creation; it cannot be read back, and
`db push` asks for it. If it is lost, reset it under Project Settings →
Database — safe here, since nothing connects to Postgres directly (the app
goes through PostgREST on the publishable key).

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
| Redirect URLs | `https://pub-golf.glyn.dev/**` | An unlisted origin is not rejected — Supabase falls back to Site URL and drops the path, which reads as an app bug |

> Do **not** run `supabase config push`. It would overwrite the production
> `site_url` with `http://localhost:3105` from `config.toml`, which is
> local-first by design — and it would re-enable the email provider, which
> local keeps on only so the e2e suite can seed sessions.

**The `preview` branch is the exception, and it is not configured here.** Its
auth comes from the `[remotes.preview]` block in `config.toml`, which
branching's Configure step applies to the branch project on every push. That
is not the same hazard as `config push`: a remote block targets one declared
project ref rather than whatever you happen to be linked to. Anything added to
`[auth]` for local dev needs considering for that block too, or local and
preview silently disagree.

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
| Preview | `https://xssmjzinaghxjncoezez.supabase.co/auth/v1/callback` |
| Local dev | `http://127.0.0.1:54331/auth/v1/callback` |

One client serves all three, so there is one secret in circulation. The branch
needs its own entry because it runs its own auth server — production's setup
does not carry over.

Where the credentials go, per environment:

- **Production** — the Supabase dashboard, by hand.
- **Preview** — *branch secrets*, read by `[remotes.preview]` in
  `config.toml`. Secrets are per-branch; production's do not carry over:

  ```bash
  supabase secrets set --project-ref xssmjzinaghxjncoezez \
    SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=... \
    SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...
  ```

- **Local dev** — `.env.local`, same two names (`supabase start` reads them
  through `config.toml`). Local also needs `skip_nonce_check`, already set.

While the consent screen is in *Testing*, only accounts on its test-user list
can sign in — publish it before letting anyone else host a round.

### 4. Vercel project

Import `glynfinck/pub-golf` at
[vercel.com/new](https://vercel.com/new) into the **glynfinck's projects**
team. Framework preset auto-detects as Next.js; leave build settings alone.

**Environment variables are per environment, and crossing them is the one
mistake that does real damage.** Nothing errors if they are wrong — the
staging app simply reads and writes production rounds.

Production:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://quncylgcwfiqsjugnvtv.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | that project's publishable key (`sb_publishable_…`) |
| `NEXT_PUBLIC_SITE_URL` | `https://pub-golf.glyn.dev` |
| `GOOGLE_PLACES_API_KEY` | Server-only. **Never** `NEXT_PUBLIC`. Application restriction must be *None* or *IP addresses* — a website restriction blocks server-side calls |

Preview — set for the **whole Preview environment**, not scoped to the
`preview` branch. Branch-scoped values do take precedence, but a silent
precedence rule is exactly how "staging wrote to prod" happens. Environment-wide
makes the invariant absolute: *no preview deployment ever holds the production
Supabase URL.* Feature-branch previews then also point at staging, which is
strictly better — they cannot write to production, and junk rows in a
throwaway database are a feature.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xssmjzinaghxjncoezez.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **branch's** publishable key |
| `NEXT_PUBLIC_SITE_URL` | `https://pub-golf-preview.glyn.dev` |
| `GOOGLE_PLACES_API_KEY` | same key as production |

`NEXT_PUBLIC_SITE_URL` is the quiet one: `lib/config.ts` **defaults it to
`https://pub-golf.glyn.dev`**, so leaving it unset on preview does not fail —
it makes every staging page advertise production URLs for `metadataBase` and
its Open Graph images.

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` plus `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`
power the course builder's map sheet — the one map ID holds the cream
style in its light slot and Midnight in its dark slot, with the map's
colorScheme selecting the variant (the legacy `_CREAM`/`_MIDNIGHT` names
are still read as fallbacks). Both are optional: without the key the
builder stays list-only, and without the map ID the sheet falls back to
Google's stock styling. The browser key is **not** the server's Places
key — it is referrer-restricted to the app's domains, where the server
key must not be.

### 5. Domains

`glyn.dev` already uses Vercel nameservers (`ns1/ns2.vercel-dns.com`), so
adding a domain in Vercel → Project → Settings → Domains creates the DNS
record automatically; no registrar changes needed.

- `pub-golf.glyn.dev` — production.
- `pub-golf-preview.glyn.dev` — set its **Git Branch** field to `preview`, and
  leave it set. A custom domain with no branch assignment points at the
  current *production* deployment, so clearing it would quietly turn the
  staging URL into a second production URL.

### 6. Access control on staging

Vercel Authentication is on with deployment type `all_except_custom_domains`,
which exempts the **production** custom domain only. So `pub-golf.glyn.dev` is
public and `pub-golf-preview.glyn.dev` sits behind a Vercel login — staging is
reachable only by someone signed in with access to the team.

The consequence worth knowing before you plan a test: you cannot hand the
staging link to anyone. Pub Golf is multiplayer, and its core loop is other
people joining a round by code. Two browser profiles on your own account will
exercise it; a friend's phone will not. Crawlers can't reach it either, so
staging Open Graph cards never unfurl — that is the gate, not a bug.

### 7. GitHub

No secrets. Two settings, both under Settings → Branches:

- Require the `verify` status check on **`main`** and **`preview`**.
- Require a pull request before merging to both.

That is what gates a deploy on tests here — see
[What that costs](#what-that-costs-stated-plainly). Skipping it means a red
suite ships itself.

## The preview environment

`preview` is a **mirror of `main`**, not a branch with a life of its own. It
carries no commits `main` does not have; when the two drift, re-mirror it
rather than merging:

```bash
git push --force-with-lease origin origin/main:refs/heads/preview
```

Its database is Supabase branch `preview` → project `xssmjzinaghxjncoezez`, a
real separate project built from `supabase/migrations` with **no production
data**. Rounds, guests and claimed cards on staging are invisible to
production and safe to throw away.

**The branch must stay persistent.** An ephemeral branch is torn down with the
git branch it tracks, and comes back with a **different project ref** — a ref
that is written down in three places: `[remotes.preview].project_id` in
`config.toml`, the Preview environment variables in Vercel, and the authorized
redirect URI on the Google OAuth client. All three would break at once, in
three different ways, none of them saying why. Persistence is what makes the
ref a constant you are allowed to write down.

It costs a dedicated Micro compute running continuously — roughly **$10/month**,
which about doubles this project's Supabase bill. Branch compute is **not**
covered by the spend cap, and compute credits do not apply to it.

### PR previews and Google sign-in

Every pull-request branch gets a throwaway Vercel URL
(`pub-golf-*-glynfincks-projects.vercel.app`), and those previews point at
the staging database already — the Preview env vars are environment-wide.
Google sign-in works on them because of two things, one free and one
configured:

- **Google never sees the app's URL.** The authorized redirect URI on the
  OAuth client is Supabase's callback, which never varies. The app side is
  origin-agnostic on purpose: `signInWithOAuth` passes
  `redirectTo: location.origin + /auth/callback`, and the callback route
  redirects relative to its own origin.
- **The branch project's allowlist has a wildcard** for this project's
  deployments (`[remotes.preview.auth].additional_redirect_urls` in
  `config.toml`). Without it, gotrue answers the unlisted origin by silently
  falling back to Site URL — which strands the PKCE verifier cookie on the
  vercel.app origin, so the exchange fails and sign-in bounces to
  `/signin?error=auth` on the *staging* domain. Nothing names the actual
  cause anywhere.

Do **not** try to route every PR onto `pub-golf-preview.glyn.dev` instead.
A Vercel custom domain binds to one git branch, so "the latest PR" needs a
`vercel alias` step in CI holding a `VERCEL_TOKEN` — the credential-free
pipeline is a deliberate trade this document already defends. It would also
make concurrent PRs clobber each other for the domain, and hand the staging
URL to code whose migrations have not run (only pushes to `preview` migrate
the branch project), which is the `42703` outage on demand.

The Vercel Authentication gate still applies: preview URLs are reachable
only by someone signed into the team, same as the staging domain. Sign-in
works *for you* on a PR preview; it still isn't a link you can hand round.

### Verifying staging is not talking to production

Worth doing once, after any change to the env vars. `NEXT_PUBLIC_*` is inlined
into the client bundle, so the served page carries the URL:

```bash
curl -s https://pub-golf-preview.glyn.dev/join | \
  grep -o 'https://[a-z]\{20\}\.supabase\.co' | sort -u
```

Expect exactly `https://xssmjzinaghxjncoezez.supabase.co`, with
`quncylgcwfiqsjugnvtv` absent. (Behind the Vercel login this needs a
`x-vercel-protection-bypass` header, or a browser view-source.)

The decisive test: create a round on staging, note its join code, then count
it in both databases. It must be **1** in the branch project and **0** in
production. Both halves are needed — the first alone does not rule out a dual
write.

## Day-to-day

Push to `main` and it goes to production; merge to `preview` to stage
something first. Vercel builds the app, Supabase applies the migrations,
neither waits for the other.

Rolling back app code is a Vercel instant rollback to the previous
deployment. Rolling back a migration is a new forward migration — never edit
an applied one, since `db push` tracks them by version.

After any schema change, regenerate types:

```bash
supabase gen types typescript --local > types/database.ts
```
