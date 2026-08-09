-- ---------------------------------------------------------------------------
-- Bug reports: what a player typed, and the public issue it became.
--
-- The report screen files a GitHub issue on a PUBLIC repository. That single
-- fact is why this table exists rather than the action simply calling GitHub:
--
--   1. Rate limiting has to live somewhere a serverless function cannot
--      outrun. There is no per-instance counter that survives a cold start,
--      so "five a day" is a count over rows, taken here, under a lock.
--   2. A report must survive GitHub being down. The row is written first and
--      the issue stamped onto it afterwards, so an unreachable API costs a
--      link, never the report.
--   3. The issue is world-readable; this table is not. Anything that
--      identifies the reporter — who they are, which round they were on —
--      stays on this row, and the issue carries only this row's id. A
--      maintainer reading the issue looks the reporter up here; a stranger
--      reading the issue learns nothing.
--
-- Point 3 has teeth: `round_code` is the join key. A code pasted into a
-- public issue is an open door onto a live round, so the code is stored here
-- and redacted out of everything that leaves for GitHub (lib/bug-report.ts,
-- which is unit-tested on exactly that).
--
-- Additive, and read by nothing already deployed — the migration can land
-- ahead of the code, which DEPLOYMENT.md requires of every migration since
-- the two integrations do not wait for each other.
-- ---------------------------------------------------------------------------

-- The allowance, as a function so it has exactly one home. The app mirrors it
-- in lib/bug-report.ts to write the copy ("five a day"), and a db test calls
-- this to prove the two still agree — a cap the screen misquotes is a player
-- told their report was filed when it was refused.
create function public.bug_report_daily_cap()
returns integer
language sql
immutable
as $$ select 5 $$;

create table public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  -- Defaulted rather than merely checked: the row is the reporter's own by
  -- construction, and the policy below has nothing to disagree with.
  reporter uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  -- Which part of the house, for triage. Free text with a check rather than
  -- an enum: adding an area later must not be a non-additive migration.
  area text not null default 'other'
    check (area in ('scoring', 'timer', 'joining', 'courses', 'payments', 'other')),
  -- What the player typed, verbatim and unredacted. The copy that reaches
  -- GitHub is built from this; this is the one that gets read when the
  -- redaction turns out to have eaten something that mattered.
  body text not null check (char_length(body) between 10 and 2000),
  -- The join key, kept off the issue on purpose. See the header.
  round_code text check (round_code is null or char_length(round_code) <= 12),
  -- Where they were standing: build, route (already redacted), hole, phase,
  -- viewport, user agent. Bounded so a crafted client cannot post a novel.
  -- Bounded by its own text, not by pg_column_size: that function is STABLE
  -- and a check constraint may only call immutable ones, so the obvious
  -- spelling is rejected at DDL time rather than at insert time.
  context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context) = 'object' and char_length(context::text) <= 4000),
  -- Stamped once GitHub answers. Null means the report is filed here and
  -- nowhere else yet — the query a maintainer runs after an outage.
  issue_number integer,
  issue_url text,
  created_at timestamptz not null default now()
);

create index bug_reports_reporter_recent_idx
  on public.bug_reports (reporter, created_at desc);

alter table public.bug_reports enable row level security;

-- Your own reports, and only ever your own. There is no official's view here:
-- a report is between the player and the club secretary, and the secretary
-- reads the database, not the app.
create policy "bug reports: read your own"
  on public.bug_reports for select to authenticated
  using (reporter = (select auth.uid()));

create policy "bug reports: file your own"
  on public.bug_reports for insert to authenticated
  with check (reporter = (select auth.uid()));

-- Stamping the issue back onto the row. The action does this on the caller's
-- own session — every write in this app reaches Postgres as the player — so
-- the policy has to allow it, and the column grant below is what stops that
-- becoming "a player may rewrite their report". USING sees OLD, so
-- `issue_number is null` makes the stamp a one-way door: a filed issue can
-- never be re-pointed at another. A player who forges their own issue_url
-- fools nobody but themselves; the issue GitHub actually holds was created
-- server-side and is not reachable from here.
create policy "bug reports: stamp your own issue once"
  on public.bug_reports for update to authenticated
  using (reporter = (select auth.uid()) and issue_number is null)
  with check (reporter = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- The allowance, counted where it cannot be outrun.
--
-- 20260816 is the precedent and the scar: a read-then-check allowance loses
-- to concurrent writers, because two transactions under READ COMMITTED each
-- take a snapshot that does not contain the other's uncommitted row, and both
-- decide there is room. A double-tapped Send is exactly that shape.
--
-- An advisory lock keyed on the reporter rather than `select ... for update`
-- on their profile row: FOR UPDATE conflicts with the FOR KEY SHARE lock that
-- every foreign key onto profiles takes, so locking the profile would put
-- this table's writes in the way of somebody joining a round. This lock
-- conflicts with nothing but another report from the same reporter, which is
-- precisely the race being closed.
--
-- Officials get no exemption and neither does the host: this is abuse
-- control on a public issue tracker, not a rule of the game.
-- ---------------------------------------------------------------------------
create function public.guard_bug_report_rate()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  filed integer;
  cap integer := public.bug_report_daily_cap();
begin
  -- service_role writes are the club secretary's own hand (and the tests'
  -- seeding); the allowance is about what a phone can do.
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.reporter::text, 0)
  );

  select count(*)
    into filed
    from public.bug_reports b
   where b.reporter = new.reporter
     and b.created_at > pg_catalog.now() - interval '24 hours';

  if filed >= cap then
    raise exception 'Bug report allowance spent (% in 24 hours)', cap
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_bug_report_rate
  before insert on public.bug_reports
  for each row execute function public.guard_bug_report_rate();

-- The Data API gate init.sql warned about — new tables are not auto-exposed.
-- `anon` is granted nothing at all: no signed-out surface ever queries this
-- table (the action requires a session, and a guest is an anonymous *user*,
-- not the anon role), so a 42501 there is the honest answer rather than a
-- policy quietly returning zero rows. service_role rides 20260811's default
-- privileges.
grant select, insert on public.bug_reports to authenticated;
-- Column-level, and the whole reason the update policy above is safe: these
-- two columns are the only ones a session may ever write after the insert.
grant update (issue_number, issue_url) on public.bug_reports to authenticated;

grant execute on function public.bug_report_daily_cap ()
  to anon, authenticated, service_role;
