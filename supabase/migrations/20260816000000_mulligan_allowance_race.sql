-- ---------------------------------------------------------------------------
-- The mulligan allowance was a read-then-check, and two thumbs beat it.
--
-- guard_score_mulligans sums the player's OTHER score rows and compares the
-- total against the ruleset. Under READ COMMITTED, two raises of the column
-- in flight together each take their own snapshot, and neither snapshot
-- contains the other's row — so both see an untouched allowance and both are
-- allowed. Five concurrent writes against an allowance of two stored five.
--
-- It is reachable without meaning to: the marker works down a player's card
-- correcting several holes in a row, and a player taps mulligan on
-- consecutive holes as the round advances. Both put more than one raise of
-- this column in flight at once, and the app's own check in `takeMulligan`
-- races in exactly the same way — which is why the fix belongs here. RLS and
-- these triggers are the only real enforcement; an action is a UX guard.
--
-- The fix is to serialise the raises on the seat they are being written to.
-- Everything cheap has already returned by then: the hot path is a swig tap,
-- which leaves mulligans at 0 and never reaches this line, and taking one
-- away returns above it too. So the lock is held only by the write that is
-- actually spending an allowance, and only against other writes spending the
-- same player's. One row, one lock, no ordering between transactions — there
-- is no cycle here to deadlock on.
--
-- Why this makes the count honest: a transaction that blocks on the lock
-- resumes only once the holder has committed, and under READ COMMITTED the
-- sum that follows takes a fresh snapshot — one that now contains the row it
-- was previously blind to.
-- ---------------------------------------------------------------------------

create or replace function public.guard_score_mulligans()
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

  -- Past here we are spending the allowance, so take the seat's lock and let
  -- the other spenders queue. See the header: without this the count below
  -- cannot see a sibling write that has not committed yet, and the allowance
  -- is whatever the table can tap simultaneously.
  perform 1
    from public.round_players rp
   where rp.id = new.player_id
     for update;

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
