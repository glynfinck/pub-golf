-- ---------------------------------------------------------------------------
-- The caddy: one conversation per patch, and the turns it took.
--
-- Course generation is not a request/response — it is a conversation. The host
-- describes a patch, the caddy plans it, and then they haggle: "more gardens
-- in the back half", "somewhere quieter for hole three", "roll it again". Two
-- tables, because those are two different lifetimes.
--
--   caddy_sessions — one per patch. Holds the brief and the dossier: the
--     candidate pubs the gather found, written down byte-stably because that
--     text is the *cached prefix* of the model conversation. Every later turn
--     re-reads it at cache rates, which is the whole reason asking can be
--     uncounted (lib/caddy/dossier.ts, and the unit test that pins it).
--
--   caddy_turns — one per caddy call, plan or roll or tweak alike. These rows
--     are three things at once and that is deliberate: the ledger fair use is
--     counted over, the transcript the next turn is built from, and the pager
--     of drafts the host flips through. No counter column to drift out of step
--     with them, and the lineage comes free.
--
-- WHAT THIS TABLE IS NOT: a meter. The caddy is not rationed on screen — no
-- counter, no "rolls left", nothing that turns red. `caddy_fair_use_cap()` is
-- armour against a script, set several times above a heavy honest session, and
-- a host who somehow meets it is told the caddy has done a full shift without
-- being quoted a number. See lib/caddy/fair-use.ts.
--
-- Additive, and read by nothing already deployed — the migration can land
-- ahead of the code, which DEPLOYMENT.md requires of every migration since the
-- two integrations do not wait for each other.
-- ---------------------------------------------------------------------------

-- The backstop, as a function so it has exactly one home. The app mirrors it
-- in lib/caddy/fair-use.ts and a db test calls this to prove the two still
-- agree — the same arrangement bug_report_daily_cap() already uses.
create function public.caddy_fair_use_cap()
returns integer
language sql
immutable
as $$ select 25 $$;

create table public.caddy_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Defaulted rather than merely checked: the row is the host's own by
  -- construction, and the policies below have nothing to disagree with.
  host uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  -- Which green fee this session was worked under. Nullable because a session
  -- outlives the entitlement row it was started on — a refunded or expired
  -- fee must never retrospectively delete a host's drafts, which is the same
  -- "covered stays covered" asymmetry 20260823 already establishes.
  entitlement_id uuid references public.entitlements (id) on delete set null,
  -- What the host asked for: where, the pins, holes, vibe, particulars, note.
  -- Read through lib/caddy/brief.ts's readBrief and never cast inline.
  brief jsonb not null default '{}'::jsonb
    check (jsonb_typeof(brief) = 'object' and char_length(brief::text) <= 4000),
  -- The candidate pubs, as the caddy was briefed on them. Bounded generously
  -- because forty dossiers with review snippets is a real amount of text, and
  -- cheaply because it is deleted the moment the session completes.
  dossier jsonb not null default '[]'::jsonb
    check (jsonb_typeof(dossier) = 'array' and char_length(dossier::text) <= 200000),
  -- Stamped when a course is saved off this session. The dossier is emptied at
  -- the same moment: Google's atmosphere facts and review snippets are read
  -- for the length of one conversation and are not ours to keep.
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index caddy_sessions_host_recent_idx
  on public.caddy_sessions (host, created_at desc);

create table public.caddy_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.caddy_sessions (id) on delete cascade,
  -- Denormalised from the session so fair use can be counted without a join,
  -- and so the trigger below can take its lock without reading another table.
  host uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  -- plan is the first card, roll is a fresh one from the same patch, tweak is
  -- an answer to something the host said. Free text with a check rather than
  -- an enum: a fourth kind later must not be a non-additive migration.
  kind text not null default 'plan'
    check (kind in ('plan', 'roll', 'tweak')),
  -- What the host said, on a tweak. Their own words, bounded; fenced on the
  -- way into the prompt by lib/caddy/plan.ts, never here.
  ask text check (ask is null or char_length(ask) <= 200),
  -- The card this turn produced: the resolved holes, already hung on real
  -- venue ids. A row exists only where a card arrived — a refusal, a cancel
  -- and a model error write nothing, which is why none of them count.
  result jsonb not null
    check (jsonb_typeof(result) = 'object' and char_length(result::text) <= 100000),
  created_at timestamptz not null default now()
);

create index caddy_turns_session_idx
  on public.caddy_turns (session_id, created_at);
-- The index the fair-use count runs on.
create index caddy_turns_host_recent_idx
  on public.caddy_turns (host, created_at desc);

alter table public.caddy_sessions enable row level security;
alter table public.caddy_turns enable row level security;

-- Your own sessions, and only ever your own. There is no official's view and
-- no member's view: a brief is the host's working notes, and the course they
-- eventually save is the only part anybody else was ever meant to see.
create policy "caddy sessions: read your own"
  on public.caddy_sessions for select to authenticated
  using (host = (select auth.uid()));

create policy "caddy sessions: start your own"
  on public.caddy_sessions for insert to authenticated
  with check (host = (select auth.uid()));

-- Completing a session — stamping completed_at and emptying the dossier — is
-- done by the host's own session, because every write in this app reaches
-- Postgres as the player. The column grant below is what keeps that from
-- becoming "a host may rewrite their brief".
create policy "caddy sessions: complete your own"
  on public.caddy_sessions for update to authenticated
  using (host = (select auth.uid()))
  with check (host = (select auth.uid()));

create policy "caddy turns: read your own"
  on public.caddy_turns for select to authenticated
  using (host = (select auth.uid()));

-- Insert only, and only onto a session you own. There is no update policy and
-- no delete policy on purpose: a turn is a fact about what happened, and a
-- host who could delete turns could reclaim fair use by tidying up after
-- themselves.
create policy "caddy turns: append to your own session"
  on public.caddy_turns for insert to authenticated
  with check (
    host = (select auth.uid())
    and exists (
      select 1 from public.caddy_sessions s
       where s.id = session_id and s.host = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Fair use, counted where a serverless function cannot outrun it.
--
-- 20260816 is the precedent and the scar: a read-then-check allowance loses to
-- concurrent writers, because two transactions under READ COMMITTED each take
-- a snapshot without the other's uncommitted row and both decide there is
-- room. A script hammering the ask endpoint is exactly that shape, with worse
-- manners than the double-tapped Send that found it the first time.
--
-- An advisory lock keyed on the host rather than `select ... for update` on
-- their profile row: FOR UPDATE conflicts with the FOR KEY SHARE lock every
-- foreign key onto profiles takes, so locking the profile would put the caddy
-- in the way of somebody joining a round. This lock conflicts with nothing but
-- another caddy turn from the same host — which also serialises the turns
-- within one session, so a conversation's transcript can never interleave.
-- ---------------------------------------------------------------------------
create function public.guard_caddy_fair_use()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  spent integer;
  cap integer := public.caddy_fair_use_cap();
begin
  -- service_role is the seeder and the tests, not the attacker this guards
  -- against — the same exemption every other guard on this stack carries.
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.host::text, 0)
  );

  select count(*)
    into spent
    from public.caddy_turns t
   where t.host = new.host
     and t.created_at > pg_catalog.now() - interval '24 hours';

  if spent >= cap then
    raise exception 'The caddy has done a full shift on this fee (% turns in 24 hours)', cap
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_caddy_fair_use
  before insert on public.caddy_turns
  for each row execute function public.guard_caddy_fair_use();

-- ---------------------------------------------------------------------------
-- The Data API gate init.sql warned about — new tables are not auto-exposed,
-- and the whole db tier goes dark the moment one is missed. `anon` is granted
-- nothing at all: no signed-out surface queries these tables (planning needs a
-- signed-in host, and a guest is an anonymous *user*, not the anon role), so a
-- 42501 there is the honest answer rather than a policy quietly returning zero
-- rows. service_role rides 20260811's default privileges.
-- ---------------------------------------------------------------------------
grant select, insert on public.caddy_sessions to authenticated;
-- Column-level, and the reason the update policy above is safe: completing a
-- session is the only thing a session may ever write after the insert. The
-- brief and the dossier are what the model was actually given, so they stay
-- exactly as they were posted.
grant update (completed_at, dossier) on public.caddy_sessions to authenticated;
grant select, insert on public.caddy_turns to authenticated;

grant execute on function public.caddy_fair_use_cap ()
  to anon, authenticated, service_role;
