# Polish

The app works. This is the list of things that still say *side project* to
somebody who has never seen it before — starting with the sign-in screen,
which currently introduces the app as a Supabase project ref.

Everything here is a gap between "the round scores correctly" and "this is a
product somebody shipped". Nothing here is a bug. Two items are launch
blockers anyway, and they are the first two.

---

## 1. Sign-in introduces the app as `quncylgcwfiqsjugnvtv.supabase.co`

**Blocker.** This is the first screen a host ever sees, and it is the least
finished thing in the product.

Three separate causes, three separate fixes. They are independent — do the
free ones first.

### 1a. The Google consent screen has no branding

Google renders the OAuth consent screen from the **Branding** page of the
Google Cloud project, not from anything in this repo. With it unset, Google
falls back to the OAuth client's domain — which is Supabase's, because the
authorized redirect URI points at `…supabase.co/auth/v1/callback`
(DEPLOYMENT.md § 3, and that is correct: Supabase handles the callback).

Set, at <https://console.cloud.google.com/auth/branding>:

| Field | Value |
| --- | --- |
| App name | `Pub Golf` |
| User support email | `glynfinck@gmail.com` |
| App logo | `public/brand/icon-512.png` |
| Application home page | `https://pub-golf.glyn.dev` |
| Privacy policy | `https://pub-golf.glyn.dev/legal/privacy` — see §2 |
| Terms of service | `https://pub-golf.glyn.dev/legal/terms` — see §2 |
| Authorized domain | `glyn.dev` |

Cost: free. The **logo** is the one field that triggers Google's brand
verification, which takes a few business days; name, links and support email
apply immediately. If you want a clean screen this week and the logo later,
set everything else now and add the logo as a follow-up — it does not block
publishing.

### 1b. The consent screen is still in Testing

DEPLOYMENT.md § 3 already says this, and it stays true until somebody acts:
**while the screen is in Testing, only accounts on its test-user list can
sign in.** Every other Google account gets an error, not a round. Anyone you
hand the app to today cannot host.

Publishing is the fix, and it is cheap here: the app requests only `openid`,
`email` and `profile`, which are non-sensitive scopes, so publishing to
Production does **not** queue you behind Google's full verification review.
It is a button. Do it once §2 exists, because publishing asks for the privacy
policy and terms URLs.

### 1c. Supabase's domain is visible in the redirect

Even with branding set, the browser visibly bounces through
`quncylgcwfiqsjugnvtv.supabase.co`, and Supabase's own docs name this exact
case as the reason custom domains exist. The fix is the **Custom Domains
add-on** — a paid add-on on a paid plan, which this org already is ($10/month
per project; confirm in the dashboard's add-on panel). It turns the auth
origin into something like `auth.pub-golf.glyn.dev`.

`glyn.dev` is already on Vercel nameservers, so the CNAME is one record.

Three things this touches, all easy to miss:

1. **Google needs the new callback URI added** — *in addition to*, not
   instead of, the existing one. Supabase keeps serving the old origin.
2. **`NEXT_PUBLIC_SUPABASE_URL` changes** in Vercel's Production environment.
3. **Everyone is signed out once.** supabase-js derives the auth cookie name
   from the URL's first hostname label (`sb-<ref>-auth-token`), so changing
   the origin changes the cookie name and every existing session stops being
   found. For hosts that is one Google tap. For **guests it is worse** — an
   anonymous session is the only thing holding their seat, so they land in
   the seat-rescue flow. Verify the cookie name in devtools before and after,
   and flip it when nobody has a live round on the board.

Do this on **production only**. Staging sits behind Vercel Authentication and
only you ever sign into it, so a second $10/month for the branch project buys
nothing.

---

## 2. There is no privacy policy, no terms, and nothing about drink

**Blocker**, twice over: Google asks for both URLs when you publish the
consent screen (§1b), and a product that signs people in with Google and
stores their name has to say what it does with it.

Two routes, `app/legal/privacy/page.tsx` and `app/legal/terms/page.tsx`, under
a shared layout using `Masthead`. Linked from the sign-in screen's footer and
from Profile.

The privacy policy is short and genuinely honest here, which is worth saying
out loud because it is a real feature of the design:

- Google sign-in stores a display name and a user id. No email is ever sent
  and no email flow exists.
- Guests get an anonymous session with a name they typed. That is the whole
  record.
- Round data is scores, penalties and pub names.
- Pub search hits Google Places; the player's IP city is read from request
  headers to aim the search and is not stored (`app/api/geo/route.ts` says so
  in a comment already — say it to players too).
- Hosted in `eu-west-2`, which matters for the UK/EU reader.
- **How to delete it all** — which is §7, and the policy is what forces it.

Separately, and not a legal checkbox: this is a **drinking game** with no
acknowledgement of that anywhere in the UI. A professional version of this
app says something. Suggested, in the house voice and light-touch:

- One line under the sign-in button: over-18s, know your limits, water is
  free.
- A line in the rules sheet: any hole can be played with a soft drink, and
  the scorecard cannot tell.
- A line on the recap: get home safe.

That last one is also just good copy for the screen people screenshot.

---

## 3. Four standard routes are missing

The 404 is the one that shows. `notFound()` is already called from
`app/courses/[id]/page.tsx:19` and `app/courses/curated/[slug]/page.tsx:44`,
and a mistyped round link is an easy thing for a group chat to produce — all
of which currently render Next's default black-on-white 404, mid-app, with no
masthead and no way back. It is the single loudest "unfinished" tell in the
product.

| File | Why |
| --- | --- |
| `app/not-found.tsx` | Above. Reuse the `app/error.tsx` shape — eyebrow, serif line, one button back to the clubhouse. "Played into the car park." |
| `app/global-error.tsx` | Catches a throw in the root layout, where `error.tsx` cannot reach. It renders its own `<html>`/`<body>`, so it cannot use `Screen`; keep it deliberately plain. |
| `app/robots.ts` | Nothing serves `/robots.txt` today. |
| `app/sitemap.ts` | Four public URLs, but their absence is noticed by every audit tool anyone will ever point at this. |

On `robots.ts`, one trap worth writing down: **do not disallow `/round/`.**
It is tempting — those pages redirect a signed-out visitor anyway — but the
Open Graph cards live at `/round/CODE/opengraph-image`, and a `Disallow`
covering that path invites the stricter unfurlers to skip the card. The round
routes already hand out nothing (`get_round_card` is nameless and scoreless by
design). Disallow `/api/` and `/auth/` and leave the rest alone.

Sitemap: `/`, `/join`, `/signin`, and the two legal pages. Nothing else is
public.

### While in there: the two error pages are byte-identical

`app/error.tsx` and `app/round/[code]/error.tsx` are the same file, verbatim.
The nested one adds nothing that the root boundary would not already do.
Either delete it, or give it the copy that justifies it — a round-scoped error
knows the round code and can offer "back to the round" instead of "play on".
The second is better; the current state is neither.

---

## 4. Metadata, viewport and install

### `maximumScale: 1` blocks pinch-zoom

`app/layout.tsx:40`. This is an accessibility failure (WCAG 2.1 SC 1.4.4,
Resize Text) and it is the kind of thing an audit flags first. It is also
mostly pointless: iOS Safari has ignored it for years, so it disables zoom for
Android users and nobody else. Drop `maximumScale` and, if the intent was to
stop the iOS focus-zoom on inputs, the actual fix is font-size ≥ 16px on
inputs — which `min-h-12` inputs almost certainly already have; worth a
check rather than a viewport lock.

### `app/manifest.ts` is missing the fields that make an install look real

Add `id: "/"` (without it, a future `start_url` change re-installs as a
different app), `scope: "/"`, `lang: "en-GB"`, `dir: "ltr"`,
`orientation: "portrait"`, `categories: ["games", "sports", "social"]`.

Add a **maskable** icon entry — currently every icon is implicitly
`purpose: "any"`, so Android will letterbox the mark inside its own shape
rather than filling the adaptive icon. This needs a padded master (the mark
inset to the safe zone), which `scripts/brand-lockups.mjs` is the natural
place to generate, next to the sizes it already writes.

Optional but high-leverage: `screenshots` with `form_factor: "narrow"` turns
Chrome's install prompt from a one-line bar into a rich card. Playwright is
already configured for a Pixel 7 — capturing two or three from the existing
`round-flow` spec is a small job.

### `app/layout.tsx` metadata gaps

`applicationName: APP_NAME`, `formatDetection: { telephone: false }` (stops
iOS turning times and codes into phone links inside a scorecard),
`alternates: { canonical: "/" }`, and `keywords` if you want the clubhouse to
rank for anything.

---

## 5. No security headers, and a dead image allowlist

There is no `headers()` in `next.config.ts` and no header work in `proxy.ts`,
so the app ships with none of the standard set. Any observer running an
automated scan on the domain sees an F, and it is about fifteen lines to fix:

- `Strict-Transport-Security` — Vercel serves HTTPS already; claim it.
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — note **`geolocation=(self)` must be allowed**:
  `components/course/pub-map-sheet.tsx:331` calls
  `navigator.geolocation.getCurrentPosition`. Deny camera, microphone,
  payment.
- `Content-Security-Policy: frame-ancestors 'none'` — the modern
  `X-Frame-Options`.

A **full** CSP (script-src, connect-src) is a bigger piece of work and should
be its own change: Next's inline bootstrap needs a nonce, and the Maps
JavaScript API pulls scripts and tiles from several Google origins. Ship the
five above now; do the full policy deliberately, in report-only mode first.

Separately, `next.config.ts` declares three `images.remotePatterns` entries
and **the app uses none of them** — `next/image` appears in exactly one file
(`components/ui/house-mark.tsx`), pointing at local `public/brand/` assets.
There is no Supabase Storage usage anywhere and no rendered Places photo. The
`{ protocol: "https", hostname: "*.supabase.co" }` wildcard in particular lets
any Supabase project on earth serve images through this app's optimizer.
Delete all three; re-add a specific one the day something needs it.

---

## 6. Database advisories worth clearing

Most of what `get_advisors` reports on production is *by design* here and
should be left alone — the anonymous-access policies are the guest flow, and
the anon-executable SECURITY DEFINER functions are `join_round`,
`get_round_card` and the `is_round_*` helpers doing their job. Leaked-password
protection is irrelevant: there are no passwords.

Two are real, and both are one small additive migration:

1. **Trigger functions are exposed as callable RPCs.**
   `guard_score_hole_window`, `guard_score_mulligans`, `handle_new_user` and
   `rls_auto_enable` are all reachable at `/rest/v1/rpc/…` by `anon` and
   `authenticated`. They are trigger functions — called out of trigger context
   they error rather than do damage — but they have no business in the public
   API surface. `REVOKE EXECUTE … FROM anon, authenticated`.

2. **`generate_round_code` has a mutable `search_path`.** The standard
   hardening: `SET search_path = ''` and schema-qualify. Cheap, and it clears
   the last WARN that is not a deliberate design decision.

Both are additive and readable by the deployed code, so they are safe under
the constraint in DEPLOYMENT.md.

---

## 7. What a shipped product has that this does not

Smaller, and none of them blocking, but each is a question somebody will ask.

- **No account deletion and no data export.** Profile offers a name, a theme
  and sign-out. §2's privacy policy has to describe a deletion path, so this
  is the item that policy will force. A "Close my account" action in the
  manage sheet, hold-to-confirm (`components/ui/hold-to-confirm.tsx` already
  exists), calling a SECURITY DEFINER function that cascades the way
  `officials strike seats` already does.
- **No error monitoring and no analytics.** Today, a round that breaks in a
  pub at 9pm produces a `digest` on a stranger's phone and nothing anywhere
  else. `app/error.tsx` already renders the digest — Sentry, or at minimum
  Vercel Analytics plus Speed Insights, makes it findable. This is the item
  that most changes how the next month feels.
- **No version stamp.** Nothing in the UI or DOM says which build is running,
  so "it did something weird last night" is unanswerable. A
  `VERCEL_GIT_COMMIT_SHA` short ref in the Profile footer, small and grey, is
  enough.
- **`app/(tabs)/page.tsx:24` greets with "Evening,"** regardless of the hour.
  Charming at 9pm, wrong at brunch. `lib/time.ts` is where the fix belongs,
  as a pure function of an hour argument, and it is a two-line unit test.

---

## The plan

Three waves, ordered so nothing waits on anything it does not have to.

### Wave 1 — in-repo, no consoles, no accounts · **shipped**

1. ✅ `app/not-found.tsx`, `app/global-error.tsx`
2. ✅ `app/robots.ts`, `app/sitemap.ts`
3. ✅ `app/legal/privacy` and `app/legal/terms` + layout, linked from sign-in
   and Profile
4. ✅ Responsible-drinking lines — sign-in, rules sheet, and the results
   screen rather than the recap card, which stays spare because it is the
   screenshot
5. ✅ Dropped `maximumScale`; inputs were already `text-base` on mobile, so
   the iOS focus-zoom it guarded against was never going to fire
6. ✅ Manifest fields + a maskable icon, generated by
   `scripts/brand-maskable.mjs`
7. ✅ Metadata fields — `applicationName`, `formatDetection`
8. ✅ Security headers; deleted the dead `remotePatterns`
9. ✅ The round's `error.tsx` now offers "back to the round", which is the
   thing the root boundary cannot know
10. ✅ Greeting by hour (`greeting` in `lib/time.ts`, unit-tested)

Two things turned up while doing it and were fixed in the same pass:

- `alternates.canonical` on the root layout is **inherited, not computed** —
  every page emitted a canonical pointing at `/`, telling crawlers the legal
  papers were the clubhouse. It was tried, seen in the served HTML, and
  removed. Next self-canonicalises; there is no duplicate URL here needing an
  override.
- The proxy matcher ran a Supabase token refresh on every
  `manifest.webmanifest` fetch. `robots.txt` and `sitemap.xml` were already
  excluded by extension; the manifest needed naming.

Wave 1 is what unblocks Wave 2 — the consent screen cannot be published
without the legal URLs from step 3.

### Wave 2 — the consoles

1. Google Cloud → Branding: name, support email, home page, the two legal
   URLs, authorized domain. **Publish the consent screen.** (Add the logo
   here too if you are happy to wait a few days for brand verification; it
   does not gate publishing.)
2. Verify a Google account that is *not* on the test-user list can host a
   round. This is the actual proof that §1b is fixed.
3. Supabase Custom Domains add-on on `quncylgcwfiqsjugnvtv` →
   `auth.pub-golf.glyn.dev`. Add the new callback URI to the Google OAuth
   client *alongside* the old one, update `NEXT_PUBLIC_SUPABASE_URL` in
   Vercel Production, and **pin `cookieOptions.name` to the current cookie
   first** — otherwise the origin change renames the auth cookie and signs
   everyone out, which for a guest means losing the seat their card lives on.
   DEPLOYMENT.md § 3 has the derivation and the exact knob.
4. ✅ DEPLOYMENT.md § 2/3/4 updated ahead of the work — branding table,
   publishing, the custom-domain procedure and its three side effects.

### Wave 3 — product debt

1. The two database advisories (one additive migration)
2. Error monitoring
3. Account deletion + the privacy policy paragraph that describes it — the
   policy currently promises an emailed request and says a self-serve control
   is coming, which is honest but is a promise with a clock on it
4. Version stamp
5. Manifest screenshots
6. **The theme-color seam**, found while screenshotting Wave 1 and left alone
   because fixing it needs a decision rather than a patch. `themeColor` in
   `app/layout.tsx` answers `prefers-color-scheme`, but the app does not:
   `ThemeProvider` has `defaultTheme="light"`, so a fresh visitor on a
   system-dark phone gets **Midnight browser chrome above a cream page**
   (verified — a dark-scheme Pixel 7 renders the cream ground). It is wrong
   in the other direction too: once someone picks Midnight in Profile, a
   light-scheme phone paints cream chrome above a dark page. A media query
   cannot follow a theme chosen in JavaScript, so the real fix is a
   `<meta name="theme-color">` synced to next-themes' resolved theme — or the
   decision that cream is simply always the chrome, which is one static value
   and no mechanism at all.

### Not recommended

- **A full CSP in the same change as the other headers.** Nonces plus the
  Maps JavaScript API is its own investigation, and a wrong `script-src`
  breaks the app silently on exactly the devices you cannot debug.
- **A custom domain on the preview project.** $10/month for a screen only you
  will ever see, behind a login only you can pass.
