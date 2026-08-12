-- ---------------------------------------------------------------------------
-- A report about a card names the card, not just the conversation.
--
-- `bug_reports.caddy_session_id` (20260910000000) says *which conversation*
-- went wrong. A conversation is up to sixty-five turns, and by the time
-- anybody triages the report the session holds every card the host ever
-- looked at — so "the caddy put a Wetherspoons on hole four" arrives attached
-- to a session whose last card may have been rolled twice since.
--
-- The feedback loop the session id was added for is: read the complaint, read
-- the trace behind the card it is about, fix the prompt or the router, ship.
-- Without the turn, the first step of that is guessing which card they meant,
-- and a guess in step one is a loop that quietly stops being run.
--
-- Nullable and additive: a report filed from the profile screen, or from a
-- drafting table that has not planned anything, carries neither id and always
-- will. `on delete set null` for the same reason the session link has it — a
-- report outlives the thing it is about, and the complaint is still a
-- complaint once the turn is swept.
--
-- Nothing about the public issue changes. The issue goes on carrying exactly
-- one opaque id — the report row's own — and whoever triages follows the link
-- into the private row. That was never "the session id is secret"; it is that
-- the public surface is already one id, and widening it by a second buys
-- nothing a lookup does not.
--
-- No grant: `bug_reports` carries table-level `select, insert` to
-- `authenticated`, which covers a column added later. The narrow column grants
-- elsewhere in this schema are deliberately narrow UPDATE grants doing real
-- work, and a redundant one here would make them look like the pattern rather
-- than the exception.
-- ---------------------------------------------------------------------------

alter table public.bug_reports
  add column if not exists caddy_turn_id uuid
    references public.caddy_turns (id) on delete set null;

comment on column public.bug_reports.caddy_turn_id is
  'The exact card this report is about — one turn of the conversation named '
  'by caddy_session_id. Private to the reporter and to service_role; never '
  'printed on the public issue.';

-- ---------------------------------------------------------------------------
-- And it may only name a turn the reporter actually took.
--
-- The same shape as `owns_caddy_session` in `20260912000000`, and needed for
-- the same reason that one was: a foreign key check runs with row security
-- OFF, so the reference proves the turn exists and proves nothing about whose
-- it is. Without this a reporter could point a report at any turn id in the
-- table — which leaks nothing through the public issue, and still puts another
-- host's card in the middle of an audit trail that exists to be trusted.
--
-- Belt and braces with the session guard rather than instead of it: the two
-- ids can disagree (a turn from a different conversation), and the cheapest
-- honest answer to that is to check the turn on its own terms — its `host`,
-- which `caddy_turns` denormalises for exactly this sort of question.
-- ---------------------------------------------------------------------------

create or replace function public.owns_caddy_turn(turn uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select turn is null
      or exists (
        select 1 from public.caddy_turns t
         where t.id = turn and t.host = auth.uid()
      );
$$;

revoke execute on function public.owns_caddy_turn(uuid) from public, anon;
grant execute on function public.owns_caddy_turn(uuid) to authenticated, service_role;

drop policy if exists "bug reports: file your own" on public.bug_reports;
create policy "bug reports: file your own" on public.bug_reports
  for insert to authenticated
  with check (
    reporter = (select auth.uid())
    and public.owns_caddy_session(caddy_session_id)
    and public.owns_caddy_turn(caddy_turn_id)
  );
