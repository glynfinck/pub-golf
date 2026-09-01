-- ---------------------------------------------------------------------------
-- Say the access model out loud instead of inheriting it.
--
-- Every narrow grant this schema relies on was written additively — `grant
-- select, insert`, `grant update (two columns)` — and nothing ever revoked
-- anything. That only expresses an intent while the table arrives with *no*
-- privileges for `anon` and `authenticated`, which is the behaviour
-- 20260811000000 quotes from init.sql: "New tables are no longer auto-exposed
-- to the Data API roles."
--
-- On 26 Aug 2026 CI went red on nine db tests and not one of them was a policy
-- or a trigger. Every failure was a grant: `anon` reading a table it is
-- granted nothing on, a host rewriting `caddy_sessions.brief`, a reporter
-- rewriting `bug_reports.body`, a host editing or deleting `caddy_turns` — the
-- bill — and a host writing its own ledger. All nine expected 42501 and got no
-- error at all, which is what a role with the full grant looks like once RLS
-- lets the statement through.
--
-- The cause was outside the repo: `.github/workflows/ci.yml` installed the
-- Supabase CLI with `version: latest`, 2.116.0 shipped that same day, and the
-- last green run on `main` (14 Aug) had been on 2.114.0. The workflow now pins
-- the known-good version, but a pin is a stopgap: it freezes the stack rather
-- than stating what this schema actually intends, and the next bump would
-- find the same soft ground.
--
-- So this migration makes the intent explicit and version-independent. It is a
-- no-op on any database whose grants are already as they were designed — which
-- includes both hosted projects, created long before the bootstrap moved.
--
-- Deliberately narrow in three ways:
--
--   * Only the five tables whose access model is asserted by tests. Restoring
--     what is proven, not guessing at what might also have drifted.
--   * `service_role` is never revoked from. It is the admin key, it rides
--     20260811000000's default privileges, and the db tier reads every row
--     back through it — revoking it here would take the whole tier dark.
--   * Default privileges are left alone. Counteracting them would change what
--     every future table gets, which is a bigger decision than this failure
--     justifies, and it is only ever the creating role's to make anyway.
--
-- Additive and safe to deploy ahead of the app, per DEPLOYMENT.md. Stronger
-- than that, in fact: no privilege the running code actually uses is ever
-- revoked, not even for an instant. `select` and `insert` stay granted
-- throughout and only the privileges that should never have been there come
-- off, so this does not depend on the platform applying a migration inside a
-- transaction to be safe.
-- ---------------------------------------------------------------------------

-- --- The caddy's conversation ----------------------------------------------
-- `anon` gets nothing: planning needs a signed-in host, and a guest is an
-- anonymous *user*, not the anon role.
revoke all on public.caddy_sessions from anon;
-- What `authenticated` must not hold. Named one privilege at a time rather
-- than `revoke all` followed by a re-grant, because `select` and `insert` are
-- the live read and write path: taking them away for even the width of a
-- statement would 42501 a host mid-plan if the platform ever applied a
-- migration outside a transaction. Nothing here is ever dropped and restored
-- — what the running code uses is never revoked in the first place.
revoke update, delete, truncate, references, trigger
  on public.caddy_sessions from authenticated;
-- Column-level, and the reason the update policy is safe: completing a session
-- is the only thing it may write after the insert. The brief and the dossier
-- are what the model was actually given, so they stay as they were posted.
-- `course_id` joined this list in the caddy migration's own later block.
grant update (completed_at, dossier, course_id) on public.caddy_sessions to authenticated;

-- --- The bill ---------------------------------------------------------------
-- Append-only on purpose: no update and no delete. A turn is what was spent,
-- and a host who could edit or drop one could zero their own spend and reclaim
-- their fair-use allowance.
revoke all on public.caddy_turns from anon;
revoke update, delete, truncate, references, trigger
  on public.caddy_turns from authenticated;

-- --- The ledger -------------------------------------------------------------
-- Read-only to the host it charges. Grants come from fulfilment as
-- service_role and spends from the guard trigger; a host may see the balance
-- and never move it. `insert` joins the revoke list here — unlike the two
-- tables above, a host was never meant to write these at all.
revoke all on public.caddy_grants from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.caddy_grants from authenticated;

revoke all on public.caddy_spends from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.caddy_spends from authenticated;

-- --- The report screen ------------------------------------------------------
-- `anon` gets nothing: no signed-out surface ever queries this table.
revoke all on public.bug_reports from anon;
revoke update, delete, truncate, references, trigger
  on public.bug_reports from authenticated;
-- Column-level, and the whole reason the update policy is safe: these two
-- columns are the only ones a session may ever write after the insert, which
-- is what makes the stamp one-way and keeps a filed report's words fixed.
grant update (issue_number, issue_url) on public.bug_reports to authenticated;
