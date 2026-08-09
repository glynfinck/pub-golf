-- ---------------------------------------------------------------------------
-- What can a thumb reach?
--
-- Every server action rides the caller's own session, so the only judge
-- that matters is the database. This migration is the adversarial pass:
-- take a phone that can only see its own card, and try to win with it.
-- Three holes closed, one clarified:
--
--   1. penalties.strokes had no bound — the action validates 1..20, but a
--      direct PostgREST insert could file "strokes: -20" on your own card
--      and win the round from the toilet.
--   2. Score writes were not hole-scoped — pre-fill hole 9 with one swig,
--      or quietly talk a filed 8 down to a 2, or file a first-ever 1
--      against a hole the substitute had already scored.
--   3. The mulligan guard let anyone LOWER the column ("an official
--      correcting the card") — including the player, who could take the
--      mulligan, keep the wiped hole, and delete the stroke it cost.
--   4. "penalties are retractable" was keyed on whose card the penalty sat
--      on, not on who called it — so a player could delete the marker's
--      call. The comment always said "retract your own mis-tap"; now the
--      policy says it too.
-- ---------------------------------------------------------------------------

-- 1. The schema bounds a penalty, not the action.
alter table public.penalties
  add constraint penalties_strokes_in_range check (strokes between 1 and 20);

-- Rows for holes that cannot exist were inert to scoring, but there is no
-- honest zero-or-negative hole either.
alter table public.scores
  add constraint scores_hole_number_positive check (hole_number >= 1);

-- 2 + 3. The hole window. "May I touch that hole" is a question about OLD,
-- NEW and the round's clock at once, which only a trigger can ask — the
-- same reason the role and handicap guards are triggers. Officials pass
-- everything: the marker's card roams every hole by design.
--
-- The one honest write this must not break: the play screen debounces
-- swigs 400ms, so a legitimate tap can land just after the caddy files the
-- hole (walking) or the card (finished). Increases and first writes on the
-- hole that was live stay open for exactly that reason — owning up is
-- always allowed; only rewriting history downward is the marker's call.
create function public.guard_score_hole_window()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  live_hole integer;
  round_status text;
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

  if new.hole_number < coalesce(live_hole, 0) then
    -- A filed hole only moves in the honest direction: a first-ever write
    -- would undercut the substitute it already scored, and a lower figure
    -- is the marker's correction to make, not yours.
    if tg_op = 'INSERT' or new.swigs < old.swigs then
      raise exception 'That hole is filed — ask the marker'
        using errcode = '42501';
    end if;
  elsif round_status = 'finished' and tg_op = 'UPDATE'
    and new.swigs < old.swigs then
    -- The card is filed: the last hole stops moving downward too.
    raise exception 'The card is filed — ask the marker'
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

create trigger scores_hole_window_guard
  before insert or update on public.scores
  for each row execute function public.guard_score_hole_window();

-- 4. Retraction follows the caller of record, not the card it landed on.
drop policy "penalties are retractable" on public.penalties;
create policy "penalties are retractable" on public.penalties
  for delete to authenticated
  using (
    exists (
      select 1 from public.round_players rp
      where rp.id = called_by and rp.profile_id = (select auth.uid())
    )
    or public.is_round_official(round_id)
  );
