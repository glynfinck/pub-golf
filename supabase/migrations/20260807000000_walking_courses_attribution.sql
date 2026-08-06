-- Walking phase, penalty attribution, saved courses, venue cache refresh.
-- Additive only — no changes to existing rows' meaning except the
-- called_by backfill (all legacy penalties were self-called).

-- ---------- Penalty attribution: who called it ----------

alter table public.penalties
  add column called_by uuid references public.round_players (id) on delete set null;

update public.penalties set called_by = player_id;

-- ---------- Walking phase between holes ----------
-- While hole_phase = 'walking', current_hole points at the UPCOMING hole
-- and hole_deadline_at is null; teeUpHole flips the phase live and arms
-- the drink timer. walk_deadline_at is the "next tee in" countdown, null
-- when the course has no walk estimate for the leg.

alter table public.rounds
  add column hole_phase text not null default 'live'
    check (hole_phase in ('live', 'walking')),
  add column walk_deadline_at timestamptz;

-- ---------- Saved courses (the builder's output) ----------
-- createRound copies course_holes into the round's holes; a course edit
-- never touches a played card.

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.course_holes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  number integer not null check (number >= 1),
  venue_id uuid references public.venues (id),
  venue_name text not null,
  drink text not null,
  par integer not null check (par between 1 and 20),
  hazard text check (hazard in ('water', 'bunker', 'dogleg')),
  hazard_note text,
  walk_minutes_to_next integer,
  unique (course_id, number)
);

create index course_holes_course_id_idx on public.course_holes (course_id);

alter table public.courses enable row level security;
alter table public.course_holes enable row level security;

create policy "own courses" on public.courses
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

create policy "own course holes" on public.course_holes
  for all to authenticated
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.owner = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.owner = (select auth.uid())
    )
  );

-- ---------- Venue cache refresh ----------
-- venues is a shared Google Places cache (open insert since init); the
-- search route upserts, so rating/fetched_at need to be refreshable.

create policy "venues are refreshable" on public.venues
  for update to authenticated using (true) with check (true);

-- ---------- Grants ----------
-- RLS constrains rows; the table-level gate still has to open.

grant select, insert, update, delete
  on public.courses, public.course_holes to authenticated;
