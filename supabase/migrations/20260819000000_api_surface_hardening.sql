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
-- PostgREST exposes every function in the `public` schema, so these four are
-- reachable at /rest/v1/rpc/<name> by anon and authenticated alike. They are
-- trigger functions: called outside a trigger they raise rather than do
-- damage (TG_OP and NEW are unset), which is why this is hardening and not a
-- fix. But an endpoint nobody should call is an endpoint that should not
-- answer.
--
-- The triggers themselves are unaffected. A trigger executes its function as
-- the table owner, not as the caller, so EXECUTE grants have nothing to do
-- with it -- which is exactly why the grant can go without anything breaking.
-- ---------------------------------------------------------------------------
revoke execute on function public.guard_score_hole_window() from anon, authenticated;
revoke execute on function public.guard_score_mulligans() from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.rls_auto_enable() from anon, authenticated;

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
