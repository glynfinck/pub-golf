-- ---------------------------------------------------------------------------
-- The last swig before "hole out" is an honest swig.
--
-- 20260814000000 closed the backfill cheat by refusing any first-ever write
-- to a hole below the live one. It also, unintentionally, threw away the
-- most ordinary write in the app: the play screen debounces taps by 400ms,
-- advanceHole increments current_hole the moment the caddy calls the hole,
-- and so a swig tapped a heartbeat before the call lands on a hole that is
-- already filed. The row was refused, the hole scored the par substitute,
-- and the player's own screen had been showing their swigs the whole time.
-- (The host never saw it — officials are exempt from the guard.)
--
-- The fix is a grace of exactly one hole: the hole immediately behind the
-- live one may still receive a first write. That is the only hole a
-- debounced tap can ever be aimed at, since teeing up the next hole is a
-- separate deliberate act by the caddy.
--
-- The trade-off, stated plainly: a player who drank nothing on the hole
-- just filed can still insert a score for it during the walk, undercutting
-- the substitute. That is visible to the whole table as it happens — the
-- standings are live on every phone — and the marker can correct it. The
-- alternative is silently robbing honest players of their last swig, which
-- is the worse of the two, and far more common than a cheat.
--
-- Everything else 20260814000000 established stands: no writing holes that
-- have not been teed up, no first write to an older filed hole, no lowering
-- a filed hole or a filed card, no taking your own mulligan back off.
-- ---------------------------------------------------------------------------

create or replace function public.guard_score_hole_window()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  live_hole integer;
  round_status text;
  /** The hole a debounced tap may still be aimed at: the one just filed. */
  graced boolean;
begin
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;
  if public.is_round_official(new.round_id) then
    return new;
  end if;

  select r.current_hole, r.status
    into live_hole, round_status
    from public.rounds r
   where r.id = new.round_id;

  -- Tomorrow's holes are not yours to book.
  if new.hole_number > coalesce(live_hole, 0) then
    raise exception 'That hole has not been teed up yet'
      using errcode = '42501';
  end if;

  graced := new.hole_number = coalesce(live_hole, 0) - 1;

  -- A first write to a hole filed longer ago than that is a backfill, and
  -- would undercut the substitute the hole has already scored.
  if new.hole_number < coalesce(live_hole, 0)
     and not graced
     and tg_op = 'INSERT' then
    raise exception 'That hole is filed — ask the marker'
      using errcode = '42501';
  end if;

  -- Downward is always the marker's hand, on any hole that is behind the
  -- live one or on a card that has been filed. Owning up stays open.
  if tg_op = 'UPDATE' and new.swigs < old.swigs
     and (new.hole_number < coalesce(live_hole, 0)
          or round_status = 'finished') then
    raise exception 'That hole is filed — ask the marker'
      using errcode = '42501';
  end if;

  -- A mulligan never comes off a card by the player's own hand, whatever
  -- the hole — that would keep the wiped hole and dodge its cost.
  if tg_op = 'UPDATE' and new.mulligans < old.mulligans then
    raise exception 'Only the marker takes a mulligan off the card'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
