-- ---------------------------------------------------------------------------
-- RLS hardening: the seat you take, the role you hold, and the round a score
-- claims to belong to.
--
-- Three holes of the same shape — a policy that says who may touch a row, but
-- never what the row may become. RLS is the only real enforcement here: every
-- server action reaches Postgres through PostgREST carrying the caller's own
-- session, and the getOfficiatedRound check in lib/actions/rounds.ts is a UX
-- guard, not a gate.
--
--  1. round_players INSERT only checked `profile_id = auth.uid()`. Anyone
--     signed in who knew a round's uuid could seat themselves in it as 'host'
--     and inherit every official power in the game.
--  2. Both UPDATE policies had USING and no WITH CHECK. Postgres then reuses
--     USING as the check, and `profile_id = auth.uid()` is still true after
--     you rewrite your own role — self-promotion passed. Same shape on
--     rounds, where an official could rewrite `host` and `code`, the route
--     key every phone in the group is holding.
--  3. scores.round_id / penalties.round_id are denormalised with nothing
--     tying them to the player's actual round, so an official of round A
--     could file rows against a player in round B — rows round B's own
--     officials can neither see nor retract.
--
-- Column-level rules live in triggers, not policies: WITH CHECK only ever
-- sees NEW, and "your role may not change" is a statement about OLD.
-- ---------------------------------------------------------------------------

-- ---------- helper ----------
-- SECURITY DEFINER like the two membership helpers beside it: the policy has
-- to read `rounds` at a moment when the caller cannot yet see the row. It
-- answers one boolean, and only ever about the caller themselves.
create function public.is_round_creator(round uuid)
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select exists (
    select 1 from public.rounds
    where id = round and host = (select auth.uid())
  );
$$;

grant execute on function public.is_round_creator (uuid) to authenticated;

-- ---------- 1. seating: join_round is the way in ----------
-- join_round is SECURITY DEFINER and owned by postgres, so it keeps seating
-- joiners regardless of this policy — and it is the only path that requires
-- knowing the code. The one seat a client may take directly is the creator's
-- own host seat, which createRound writes between the round insert and the
-- holes insert (the holes policy needs is_round_official, so the host has to
-- already be seated).
drop policy "players join as themselves" on public.round_players;

create policy "creators take the host seat" on public.round_players
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and role = 'host'
    and public.is_round_creator(round_id)
  );

-- ---------- 2a. round_players: your card is yours, your role is not ----------
drop policy "players update themselves" on public.round_players;

-- Your own card: the name on it, your withdrawal. `role` is left to the
-- trigger below — the only place OLD and NEW can be compared.
create policy "players update their own card" on public.round_players
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- Officials update anyone but the host. `role <> 'host'` in USING reads the
-- stored row, so the host's seat cannot be demoted out from under them; the
-- same test in WITH CHECK means nobody can be promoted into a second one.
create policy "officials update players" on public.round_players
  for update to authenticated
  using (public.is_round_official(round_id) and role <> 'host')
  with check (public.is_round_official(round_id) and role <> 'host');

create function public.guard_round_player_update()
returns trigger
language plpgsql
security invoker set search_path = ''
as $$
begin
  -- Only API callers are constrained. The service role already holds the keys
  -- to the building (test fixtures, support scripts), and migrations run as
  -- postgres.
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  if new.round_id is distinct from old.round_id
     or new.profile_id is distinct from old.profile_id then
    raise exception 'A card cannot change rounds or change hands'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    if old.role = 'host' or new.role = 'host' then
      raise exception 'The host seat is fixed at creation'
        using errcode = '42501';
    end if;
    -- Step down freely; nobody raises their own card.
    if new.profile_id = (select auth.uid()) and new.role <> 'player' then
      raise exception 'You cannot promote yourself'
        using errcode = '42501';
    end if;
    if not public.is_round_official(old.round_id) then
      raise exception 'Only the host or a caddy changes roles'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger round_players_guard
  before update on public.round_players
  for each row execute function public.guard_round_player_update();

-- ---------- 2b. rounds: officials run a round, they do not own it ----------
drop policy "officials update rounds" on public.rounds;

create policy "officials update rounds" on public.rounds
  for update to authenticated
  using (public.is_round_official(id))
  with check (public.is_round_official(id));

-- `code` is the route key every phone is holding, and `host` is the only
-- thing deciding who could ever have taken the host seat. Neither is a
-- caddy's to rewrite. Status, current_hole, hole_phase and the deadlines —
-- everything the caddy controls actually touch — stay free.
create function public.guard_round_update()
returns trigger
language plpgsql
security invoker set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.code is distinct from old.code
     or new.host is distinct from old.host
     or new.game_type is distinct from old.game_type
     or new.created_at is distinct from old.created_at then
    raise exception 'A round''s identity — code, host, game type — is fixed at creation'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger rounds_guard
  before update on public.rounds
  for each row execute function public.guard_round_update();

-- ---------- 3. a score belongs to its player's round, provably ----------
-- Declarative rather than trigger-shaped: a composite foreign key makes the
-- denormalised round_id the player's round by construction, on every path.

-- The constraint cannot be added over a lie. These straighten any disagreeing
-- rows first, and do nothing at all on a healthy database.
update public.scores s
  set round_id = rp.round_id
  from public.round_players rp
  where rp.id = s.player_id and s.round_id is distinct from rp.round_id;

update public.penalties p
  set round_id = rp.round_id
  from public.round_players rp
  where rp.id = p.player_id and p.round_id is distinct from rp.round_id;

alter table public.round_players
  add constraint round_players_id_round_key unique (id, round_id);

alter table public.scores
  drop constraint scores_player_id_fkey,
  add constraint scores_player_id_round_id_fkey
    foreign key (player_id, round_id)
    references public.round_players (id, round_id)
    on delete cascade;

alter table public.penalties
  drop constraint penalties_player_id_fkey,
  add constraint penalties_player_id_round_id_fkey
    foreign key (player_id, round_id)
    references public.round_players (id, round_id)
    on delete cascade;

-- ---------- 4. WITH CHECK where USING was quietly doing double duty ----------
-- Neither of these was exploitable, but leaning on USING-as-WITH-CHECK is how
-- the holes above happened. Say it out loud.
drop policy "players update own scores" on public.scores;
create policy "players update own scores" on public.scores
  for update to authenticated
  using (
    exists (
      select 1 from public.round_players rp
      where rp.id = player_id and rp.profile_id = (select auth.uid())
    )
    or public.is_round_official(round_id)
  )
  with check (
    exists (
      select 1 from public.round_players rp
      where rp.id = player_id and rp.profile_id = (select auth.uid())
    )
    or public.is_round_official(round_id)
  );

drop policy "own profile is updatable" on public.profiles;
create policy "own profile is updatable" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
