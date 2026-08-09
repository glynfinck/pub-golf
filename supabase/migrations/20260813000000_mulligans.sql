-- ---------------------------------------------------------------------------
-- Breakfast balls are mulligans now, all the way down.
--
-- Deliberately NOT additive: the app is pre-launch, so this is the one
-- moment a rename costs nothing but the deploy window it breaks — the
-- currently-deployed build reads breakfast_balls until its own redeploy
-- lands a minute later. Accepted on PR #10; the alternative was carrying
-- the old vocabulary in the schema forever.
--
-- Everything renames together — the column, the guard, and the jsonb keys
-- in every stored snapshot — so no compatibility shim survives to launch.
-- ---------------------------------------------------------------------------

alter table public.scores rename column breakfast_balls to mulligans;

-- The allowance guard rides along: same rule, new names, new jsonb key.
drop trigger scores_breakfast_ball_guard on public.scores;
drop function public.guard_score_breakfast_balls();

create function public.guard_score_mulligans()
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
  if new.mulligans = 0 then
    return new;
  end if;

  -- Taking one away is always allowed — that is an official correcting the
  -- card. Kept as its own statement rather than folded into the test above:
  -- SQL's AND does not promise to short-circuit, and OLD is unassigned on an
  -- INSERT, so touching it there would raise instead of returning.
  if tg_op = 'UPDATE' and new.mulligans <= old.mulligans then
    return new;
  end if;

  -- Read the number defensively: ruleset is free-form jsonb, and a bad value
  -- there must not turn into a cast error on somebody's phone.
  select case
           when jsonb_typeof(r.ruleset -> 'mulligans') = 'number'
             then greatest(0, floor((r.ruleset ->> 'mulligans')::numeric)::integer)
           else 0
         end
    into allowance
    from public.rounds r
   where r.id = new.round_id;

  -- Every score row for this player is in this round — round_players.id
  -- belongs to exactly one round — so player_id alone scopes the count.
  select coalesce(sum(s.mulligans), 0)
    into already
    from public.scores s
   where s.player_id = new.player_id
     and s.id is distinct from new.id;

  if already + new.mulligans > coalesce(allowance, 0) then
    raise exception 'No mulligans left on this card'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger scores_mulligan_guard
  before insert or update on public.scores
  for each row execute function public.guard_score_mulligans();

-- Carry the stored snapshots across. rounds snapshot the ruleset at
-- creation and rulesets hold the reusable config; both spell the keys the
-- old way in any row written before this migration. jsonb_strip_nulls
-- drops the new key rather than writing "mulligans": null when the old
-- one was never there.
update public.rounds
   set ruleset = (ruleset - 'breakfastBalls' - 'breakfastBallStrokes')
       || jsonb_strip_nulls(jsonb_build_object(
            'mulligans', ruleset -> 'breakfastBalls',
            'mulliganStrokes', ruleset -> 'breakfastBallStrokes'))
 where ruleset ?| array['breakfastBalls', 'breakfastBallStrokes'];

update public.rulesets
   set config = (config - 'breakfastBalls' - 'breakfastBallStrokes')
       || jsonb_strip_nulls(jsonb_build_object(
            'mulligans', config -> 'breakfastBalls',
            'mulliganStrokes', config -> 'breakfastBallStrokes'))
 where config ?| array['breakfastBalls', 'breakfastBallStrokes'];
