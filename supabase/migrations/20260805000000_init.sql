-- ============================================================
-- Parlour · initial schema
-- Platform model: game_types (pub_golf is the flagship) own
-- reusable rulesets; a round snapshots its ruleset, orders its
-- holes (venues), and collects players, scores and penalties.
-- Guests sign in anonymously, so RLS always has an auth.uid().
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default 'Player',
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', 'Player')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- game types & rulesets ----------
create table public.game_types (
  id text primary key,
  name text not null,
  description text,
  is_curated boolean not null default false
);

create table public.rulesets (
  id uuid primary key default gen_random_uuid(),
  game_type text not null references public.game_types,
  name text not null,
  -- format, timers, hazards, penalty table — the whole back of the card
  config jsonb not null default '{}'::jsonb,
  owner uuid references public.profiles (id) on delete set null,
  is_preset boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- venues (Google Places cache) ----------
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  google_place_id text unique,
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  rating numeric(2, 1),
  review_count integer,
  fetched_at timestamptz not null default now()
);

-- ---------- rounds ----------
-- Join codes double as the public route key (/round/TAVERN): 6 chars from a
-- 32-char alphabet with 0/O/1/I removed. 32 divides 256, so modulo has no
-- bias. Uniqueness is enforced by the column constraint; the default
-- retries until it finds a free code.
create function public.generate_round_code()
returns text
language plpgsql
volatile
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

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.generate_round_code(),
  name text not null,
  game_type text not null default 'pub_golf' references public.game_types,
  -- snapshot of the ruleset config at creation; edits never rewrite history
  ruleset jsonb not null default '{}'::jsonb,
  host uuid not null references public.profiles (id),
  status text not null default 'lobby'
    check (status in ('lobby', 'live', 'finished')),
  current_hole integer not null default 1,
  -- single source of truth for the synced hole timer: clients count down
  -- to this timestamp locally, so every phone reads the same second
  hole_deadline_at timestamptz,
  tee_off_at timestamptz,
  created_at timestamptz not null default now()
);

create index rounds_code_idx on public.rounds (code);

-- ---------- holes ----------
create table public.holes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds on delete cascade,
  number integer not null check (number >= 1),
  venue_id uuid references public.venues,
  venue_name text not null,
  drink text not null,
  par integer not null check (par between 1 and 20),
  hazard text check (hazard in ('water', 'bunker', 'dogleg')),
  hazard_note text,
  walk_minutes_to_next integer,
  unique (round_id, number)
);

-- ---------- players ----------
create table public.round_players (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  display_name text not null,
  role text not null default 'player'
    check (role in ('host', 'caddy', 'player')),
  withdrew_at_hole integer,
  joined_at timestamptz not null default now(),
  unique (round_id, profile_id)
);

create index round_players_round_idx on public.round_players (round_id);

-- ---------- scores ----------
create table public.scores (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds on delete cascade,
  player_id uuid not null references public.round_players on delete cascade,
  hole_number integer not null,
  swigs integer not null default 0 check (swigs >= 0),
  updated_at timestamptz not null default now(),
  unique (player_id, hole_number)
);

create index scores_round_idx on public.scores (round_id);

-- ---------- penalties ----------
create table public.penalties (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds on delete cascade,
  player_id uuid not null references public.round_players on delete cascade,
  hole_number integer,
  strokes integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index penalties_round_idx on public.penalties (round_id);

-- ============================================================
-- Row-level security
-- ============================================================

alter table public.profiles enable row level security;
alter table public.game_types enable row level security;
alter table public.rulesets enable row level security;
alter table public.venues enable row level security;
alter table public.rounds enable row level security;
alter table public.holes enable row level security;
alter table public.round_players enable row level security;
alter table public.scores enable row level security;
alter table public.penalties enable row level security;

-- Membership helper. SECURITY DEFINER so policies on round_players itself
-- don't recurse.
create function public.is_round_member(round uuid)
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select exists (
    select 1 from public.round_players
    where round_id = round and profile_id = (select auth.uid())
  );
$$;

create function public.is_round_official(round uuid)
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select exists (
    select 1 from public.round_players
    where round_id = round
      and profile_id = (select auth.uid())
      and role in ('host', 'caddy')
  );
$$;

-- profiles: readable by any signed-in user, writable by the owner
create policy "profiles are readable" on public.profiles
  for select to authenticated using (true);
create policy "own profile is updatable" on public.profiles
  for update to authenticated using (id = (select auth.uid()));

-- game_types: public catalogue
create policy "game types are readable" on public.game_types
  for select to authenticated using (true);

-- rulesets: presets readable by all; private ones by their owner
create policy "rulesets are readable" on public.rulesets
  for select to authenticated
  using (is_preset or owner = (select auth.uid()));
create policy "own rulesets are writable" on public.rulesets
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- venues: shared read cache, any member can add
create policy "venues are readable" on public.venues
  for select to authenticated using (true);
create policy "venues are insertable" on public.venues
  for insert to authenticated with check (true);

-- rounds: members read; anyone signed-in creates as host; officials update
-- host = auth.uid() matters at creation: the INSERT ... RETURNING runs
-- before the host's round_players row exists.
create policy "members read rounds" on public.rounds
  for select to authenticated
  using (public.is_round_member(id) or host = (select auth.uid()));
create policy "hosts create rounds" on public.rounds
  for insert to authenticated with check (host = (select auth.uid()));
create policy "officials update rounds" on public.rounds
  for update to authenticated using (public.is_round_official(id));

-- holes: members read; officials manage
create policy "members read holes" on public.holes
  for select to authenticated using (public.is_round_member(round_id));
create policy "officials manage holes" on public.holes
  for all to authenticated
  using (public.is_round_official(round_id))
  with check (public.is_round_official(round_id));

-- round_players: members read each other; joining inserts yourself;
-- you update yourself, officials update anyone
create policy "members read players" on public.round_players
  for select to authenticated using (public.is_round_member(round_id));
create policy "players join as themselves" on public.round_players
  for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "players update themselves" on public.round_players
  for update to authenticated
  using (
    profile_id = (select auth.uid())
    or public.is_round_official(round_id)
  );

-- scores: members read; you write your own, officials write anyone's
create policy "members read scores" on public.scores
  for select to authenticated using (public.is_round_member(round_id));
create policy "players write own scores" on public.scores
  for insert to authenticated
  with check (
    exists (
      select 1 from public.round_players rp
      where rp.id = player_id and rp.profile_id = (select auth.uid())
    )
    or public.is_round_official(round_id)
  );
create policy "players update own scores" on public.scores
  for update to authenticated
  using (
    exists (
      select 1 from public.round_players rp
      where rp.id = player_id and rp.profile_id = (select auth.uid())
    )
    or public.is_round_official(round_id)
  );

-- penalties: members read; you may own up yourself, officials call anyone's
create policy "members read penalties" on public.penalties
  for select to authenticated using (public.is_round_member(round_id));
create policy "penalties are called" on public.penalties
  for insert to authenticated
  with check (
    exists (
      select 1 from public.round_players rp
      where rp.id = player_id and rp.profile_id = (select auth.uid())
    )
    or public.is_round_official(round_id)
  );
-- Undo: you can retract your own penalty (a mis-tap), officials anyone's.
create policy "penalties are retractable" on public.penalties
  for delete to authenticated
  using (
    exists (
      select 1 from public.round_players rp
      where rp.id = player_id and rp.profile_id = (select auth.uid())
    )
    or public.is_round_official(round_id)
  );

-- Joining by code: the joiner is not yet a member, so a SECURITY DEFINER
-- function does the lookup + insert atomically without exposing rounds.
-- Returns the code — it is the route key.
create function public.join_round(join_code text, player_name text)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  target public.rounds%rowtype;
begin
  select * into target
  from public.rounds
  where code = upper(join_code) and status in ('lobby', 'live');

  if not found then
    raise exception 'No open round with that code';
  end if;

  insert into public.round_players (round_id, profile_id, display_name)
  values (target.id, (select auth.uid()), player_name)
  on conflict (round_id, profile_id) do nothing;

  return target.code;
end;
$$;

-- Pre-join preview for the join screen: enough to show what you're
-- signing up for, nothing more. Safe for signed-out visitors.
create function public.get_round_preview(join_code text)
returns table (
  name text,
  game_type text,
  status text,
  tee_off_at timestamptz,
  hole_count bigint,
  par bigint,
  player_count bigint,
  host_name text
)
language sql
security definer set search_path = ''
stable
as $$
  select
    r.name,
    r.game_type,
    r.status,
    r.tee_off_at,
    (select count(*) from public.holes h where h.round_id = r.id),
    (select coalesce(sum(h.par), 0) from public.holes h where h.round_id = r.id),
    (select count(*) from public.round_players p where p.round_id = r.id),
    (select p.display_name from public.round_players p
      where p.round_id = r.id and p.role = 'host' limit 1)
  from public.rounds r
  where r.code = upper(join_code) and r.status in ('lobby', 'live');
$$;

-- Realtime: lobby presence and live scores ride these tables
alter publication supabase_realtime
  add table public.rounds, public.round_players, public.scores,
            public.penalties;

-- ---------- grants ----------
-- New tables are no longer auto-exposed to the Data API roles; RLS still
-- constrains rows — these grants only open the table-level gate.
grant select on public.game_types to anon, authenticated;
grant select, insert, update, delete on
  public.profiles, public.rulesets, public.venues, public.rounds,
  public.holes, public.round_players, public.scores, public.penalties
  to authenticated;
grant execute on function
  public.is_round_member (uuid),
  public.is_round_official (uuid),
  public.join_round (text, text)
  to authenticated;
grant execute on function public.get_round_preview (text)
  to anon, authenticated;

-- game_types is a public catalogue — let signed-out visitors browse it too
drop policy "game types are readable" on public.game_types;
create policy "game types are readable" on public.game_types
  for select to anon, authenticated using (true);

-- ---------- seed the flagship ----------
insert into public.game_types (id, name, description, is_curated)
values (
  'pub_golf',
  'Pub Golf',
  'Nine pubs, park to park. Order the club listed for the hole, count '
  || 'every swallow — your swigs are your score. Lowest total wins.',
  true
);
