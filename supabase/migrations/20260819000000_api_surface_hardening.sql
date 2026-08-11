-- API surface hardening: two advisories from the production linter, both
-- additive and both readable by the currently-deployed code.
--
-- Neither is a live hole. The point is that the API surface should only
-- contain what is meant to be called, so the next audit's warnings are all
-- deliberate ones and a real finding is not buried among expected noise.
--
-- Deliberately NOT touched: the anon-executable SECURITY DEFINER functions
-- the linter also flags -- join_round, get_round_card, get_round_preview and
-- the is_round_* helpers. Those are the guest flow and the crawler's card,
-- and they are anon-callable on purpose.

-- ---------------------------------------------------------------------------
-- 1. Trigger functions are not RPCs.
--
-- The production linter flags these four as executable by anon and
-- authenticated. Stated precisely, because the linter's wording is broader
-- than the fact: what is true is that both roles hold EXECUTE. What is *not*
-- true is that either could reach them over the API -- all four return
-- `trigger`, and PostgREST leaves trigger functions out of its schema cache
-- because it has no way to call one.
--
-- So this is least privilege, not a closed hole, and it is worth being clear
-- about that: nothing was reachable before and nothing changes for a caller.
-- The gain is that the next audit's warnings are all deliberate, so a real
-- finding is not sitting in a list of expected ones.
--
-- The triggers themselves are unaffected. A trigger executes its function as
-- the table owner, not as the caller, so EXECUTE grants have nothing to do
-- with it -- which is exactly why the grant can go without anything breaking.
--
-- Each revoke is guarded, and the reason is worth writing down: the linter
-- reported `public.rls_auto_enable()` on production, and **no migration in
-- this repo creates it.** A database built from `supabase/migrations` -- local,
-- CI, the preview branch project -- does not have that function, so a bare
-- revoke is a hard `42883` there and takes the whole migration down with it.
-- Production has drifted: something made that function by hand. Rather than
-- pretend otherwise, revoke what is actually present in whichever database
-- this runs against, and let the drift be visible rather than fatal.
--
-- Two details that decide whether this works at all:
--
--   * `to_regprocedure` answers null for a function that does not exist
--     instead of raising, which is what lets one file be correct against both
--     a from-migrations database and the drifted production one.
--
--   * The revoke has to name **public** as well as the two roles. Postgres
--     grants EXECUTE to PUBLIC on every new function by default, so revoking
--     from `anon, authenticated` alone drops explicit grants and changes
--     nothing: both roles still reach the function through PUBLIC, and
--     `has_function_privilege` still answers true. Verified against a real
--     Postgres 16 rather than assumed -- the first draft of this migration
--     was a no-op that looked like a fix.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.guard_score_hole_window()',
    'public.guard_score_mulligans()',
    'public.handle_new_user()',
    'public.rls_auto_enable()'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format(
        'revoke execute on function %s from public, anon, authenticated', fn
      );
    else
      raise notice 'skipping %, not present in this database', fn;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. generate_round_code gets a fixed search_path.
--
-- It is the one function in the schema still resolving unqualified names
-- against whatever search_path the caller arrives with. It is not SECURITY
-- DEFINER, so this is not the classic privilege-escalation shape -- but it is
-- called from a column default on `rounds`, and a function that decides join
-- codes should not be resolving `generate_series` through a path a caller
-- chose.
--
-- Setting search_path to '' means every name must now be schema-qualified;
-- `generate_series` and `substr` come from pg_catalog (always implicitly
-- searched, even with an empty path), `gen_random_bytes` was already
-- extensions-qualified, and `rounds` was already public-qualified. The body
-- is otherwise character for character what it was.
-- ---------------------------------------------------------------------------
create or replace function public.generate_round_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  loop
    select string_agg(
      substr(alphabet, get_byte(extensions.gen_random_bytes(1), 0) % 32 + 1, 1),
      ''
    )
    into candidate
    from generate_series(1, 6);

    exit when not exists (
      select 1 from public.rounds where code = candidate
    );
  end loop;
  return candidate;
end;
$$;
