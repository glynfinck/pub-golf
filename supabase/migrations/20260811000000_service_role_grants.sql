-- ---------------------------------------------------------------------------
-- The service role can reach the tables.
--
-- `service_role` is the admin key: it bypasses RLS and is how a trusted
-- process reads a row back to check what the database really stored. But
-- bypassing RLS is worth nothing without the table-level gate, and this schema
-- had never opened it — every grant since init went to `anon` and
-- `authenticated`, the two roles the app itself uses.
--
-- Nothing noticed because nothing had ever driven PostgREST as the service
-- role. The e2e suite holds the service key but spends it only on the GoTrue
-- admin API (`auth.admin.createUser`), which needs no table privileges. The
-- database tests are the first code to read tables with it, and they failed on
-- the first table they touched:
--
--     permission denied for table game_types   -- 42501, a grant, not a policy
--
-- Note that shape: an RLS refusal returns no rows and NO error. A 42501 is
-- always the gate, never the policy.
--
-- The second statement is the one that stops this recurring. init.sql already
-- carries the scar — "New tables are no longer auto-exposed to the Data API
-- roles" — and the fix there was to enumerate the tables, which is exactly why
-- every table added since has been missing here. Default privileges keep the
-- next one from being missed.
-- ---------------------------------------------------------------------------

-- Catch up: everything on the books today.
grant select, insert, update, delete
  on all tables in schema public to service_role;

-- Stay caught up: anything a later migration creates. Migrations run as the
-- owner, so this covers the tables that matter.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
