-- ---------------------------------------------------------------------------
-- Three rules the model could only half-express.
--
-- 1. Local rules. `penalties.hole_number` was already written on every row,
--    but the *menu* was one flat list on the round — every hole offered the
--    same offences, and a rule that belonged to one pub could only be typed
--    into `hazard_note`, where it reads nicely and scores nothing. Holes now
--    carry their own penalty table, snapshotted from the course like par is.
--
-- 2. Breakfast balls. A hole going badly could only be drunk through. One
--    breakfast ball wipes the hole and costs a half pint — recorded on the
--    score row, because a mulligan is a fact about a player-hole and `scores`
--    is already keyed exactly that way.
--
-- 3. Handicaps. Per round, not per profile: a round snapshots everything else
--    about itself, and last summer's form is nobody's business this summer.
--
-- All four columns are additive with defaults, so every round already on the
-- books reads as "no local rules, no breakfast balls, no handicap" without a
-- backfill.
-- ---------------------------------------------------------------------------

-- `holes` and `course_holes` are field-identical on purpose — createRound
-- copies one to the other field for field. They have to gain this together.
alter table public.holes
  add column penalties jsonb not null default '[]'::jsonb;

alter table public.course_holes
  add column penalties jsonb not null default '[]'::jsonb;

alter table public.scores
  add column breakfast_balls integer not null default 0
    check (breakfast_balls >= 0);

alter table public.round_players
  add column handicap integer not null default 0
    check (handicap between 0 and 54);

-- ---------------------------------------------------------------------------
-- Handicaps are set by officials, not by the player they flatter.
--
-- This has to be a trigger for the same reason the role rule is: the two
-- UPDATE policies on round_players are "your own card" and "officials update
-- anyone but the host", and a plain player editing their own handicap passes
-- the first one. Only a trigger can compare OLD to NEW and ask *which column*
-- moved. is_round_official covers both legitimate paths — the host editing
-- their own row (which goes through the self policy, since the officials
-- policy excludes role = 'host') and any official editing a player's row.
-- ---------------------------------------------------------------------------
create or replace function public.guard_round_player_update()
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

  if new.handicap is distinct from old.handicap
     and not public.is_round_official(old.round_id) then
    raise exception 'Only the host or a caddy sets a handicap'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The breakfast ball allowance.
--
-- "At most N across the whole round" is a statement about sibling rows, and
-- WITH CHECK only ever sees the one being written — so this is a trigger too.
-- SECURITY DEFINER like the membership helpers: the count must be the true
-- one, not whatever the caller's read policies happen to expose.
--
-- The allowance lives in the round's snapshotted ruleset, so a round played
-- before breakfast balls existed reads as zero and refuses them outright.
-- ---------------------------------------------------------------------------
create function public.guard_score_breakfast_balls()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  allowance integer;
  already integer;
begin
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  -- The hot path is a swig tap, which never raises this column.
  if new.breakfast_balls = 0 then
    return new;
  end if;

  -- Taking one away is always allowed — that is an official correcting the
  -- card. Kept as its own statement rather than folded into the test above:
  -- SQL's AND does not promise to short-circuit, and OLD is unassigned on an
  -- INSERT, so touching it there would raise instead of returning.
  if tg_op = 'UPDATE' and new.breakfast_balls <= old.breakfast_balls then
    return new;
  end if;

  -- Read the number defensively: ruleset is free-form jsonb, and a bad value
  -- there must not turn into a cast error on somebody's phone.
  select case
           when jsonb_typeof(r.ruleset -> 'breakfastBalls') = 'number'
             then greatest(0, floor((r.ruleset ->> 'breakfastBalls')::numeric)::integer)
           else 0
         end
    into allowance
    from public.rounds r
   where r.id = new.round_id;

  -- Every score row for this player is in this round — round_players.id
  -- belongs to exactly one round — so player_id alone scopes the count.
  select coalesce(sum(s.breakfast_balls), 0)
    into already
    from public.scores s
   where s.player_id = new.player_id
     and s.id is distinct from new.id;

  if already + new.breakfast_balls > coalesce(allowance, 0) then
    raise exception 'No breakfast balls left on this card'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger scores_breakfast_ball_guard
  before insert or update on public.scores
  for each row execute function public.guard_score_breakfast_balls();
