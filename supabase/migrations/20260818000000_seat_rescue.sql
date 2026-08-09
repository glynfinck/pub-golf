-- ---------------------------------------------------------------------------
-- Seat rescue: the way back onto your card when a phone loses its session,
-- and the officials' broom for a seat that should not be there.
--
-- A guest's identity is one anonymous session in one browser's cookie jar —
-- in-app browsers are the usual thief. The seat is the durable thing: scores
-- and penalties hang off round_players.id, not the auth uid. So recovery is
-- moving the seat onto the caller's fresh uid, never resurrecting the dead
-- session. Three rules keep it honest:
--
--   1. Knock, don't take. request_seat_rescue only marks the seat; the hand
--      change happens in approve_seat_rescue, and only an official calls it
--      — the caddy waves you back in, so nobody impersonates a mate by
--      picking their name off a list.
--   2. Only anonymous, non-host seats move. A card claimed with Google signs
--      back in with Google; the host's seat is fixed at creation.
--   3. One door. The guard trigger still refuses a card "changing hands"
--      everywhere except approve_seat_rescue's own sanctioned write, flagged
--      through a transaction-local setting nothing else sets.
--
-- The knock itself rides two nullable columns on the seat, so the officials'
-- phones learn about it through the round_players realtime subscription they
-- already hold — no new channel, no new table.
--
-- Striking a seat is the cleanup half: a DELETE policy for officials,
-- mirroring "hosts delete rounds". The cascades already do the sums — the
-- struck seat's scores and penalties go with it, and penalties it *called*
-- on other cards survive with attribution released (called_by is
-- `on delete set null` since 20260807).
--
-- Additive and deploy-safe: two nullable columns, new functions, one policy.
-- Currently-deployed code never mentions any of them.
-- ---------------------------------------------------------------------------

alter table public.round_players
  add column rescue_requested_by uuid references public.profiles (id) on delete set null,
  add column rescue_requested_at timestamptz;

-- ---------- the sanctioned door ----------
-- Identical to 20260809's body plus the seat_rescue bypass: the one write
-- allowed to change a card's hands is the one approve_seat_rescue makes in
-- the transaction where it set this flag, having already checked everything
-- the trigger exists to stop.
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

  if current_setting('pubgolf.seat_rescue', true) = '1' then
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

-- ---------- the rescue screen's read ----------
-- The seats as a seatless visitor may see them: names, progress, and whether
-- each card can be knocked on. Deliberately authenticated-only — the join
-- preview shows a host name to anyone, but the full guest list waits for at
-- least an anonymous session, so a crawler holding a shared link reads
-- nothing (get_round_card stays the nameless public surface).
create function public.get_round_seats(join_code text)
returns table (
  seat_id uuid,
  display_name text,
  role text,
  holes_scored bigint,
  claimable boolean,
  requested boolean,
  requested_by_me boolean,
  mine boolean
)
language sql
security definer set search_path = ''
stable
as $$
  select
    rp.id,
    rp.display_name,
    rp.role,
    (select count(*) from public.scores s
      where s.player_id = rp.id and s.swigs > 0),
    coalesce(
      rp.role <> 'host'
        and rp.profile_id <> (select auth.uid())
        and exists (
          select 1 from auth.users u
          where u.id = rp.profile_id and u.is_anonymous
        ),
      false
    ),
    rp.rescue_requested_by is not null,
    coalesce(rp.rescue_requested_by = (select auth.uid()), false),
    coalesce(rp.profile_id = (select auth.uid()), false)
  from public.round_players rp
  join public.rounds r on r.id = rp.round_id
  where r.code = upper(join_code)
  order by rp.joined_at;
$$;

-- ---------- knocking ----------
create function public.request_seat_rescue(join_code text, seat uuid)
returns void
language plpgsql
security definer set search_path = ''
volatile
as $$
declare
  caller uuid := (select auth.uid());
  target public.rounds%rowtype;
  seat_row public.round_players%rowtype;
begin
  if caller is null then
    raise exception 'Sign in before knocking' using errcode = '42501';
  end if;

  select r.* into target
  from public.rounds r
  where r.code = upper(join_code);
  if not found then
    raise exception 'No round with that code';
  end if;

  select rp.* into seat_row
  from public.round_players rp
  where rp.id = seat and rp.round_id = target.id
  for update;
  if not found then
    raise exception 'That card is not in this round';
  end if;

  if seat_row.role = 'host' then
    raise exception 'The host''s card signs back in with Google'
      using errcode = '42501';
  end if;
  if seat_row.profile_id = caller then
    raise exception 'That card is already yours' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.round_players rp
    where rp.round_id = target.id and rp.profile_id = caller
  ) then
    raise exception 'You already hold a card in this round — an official can strike the spare'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = seat_row.profile_id and u.is_anonymous
  ) then
    raise exception 'That card has been claimed — it signs back in with Google'
      using errcode = '42501';
  end if;

  -- One knock per person: aiming at a different seat withdraws the old one.
  update public.round_players
    set rescue_requested_by = null, rescue_requested_at = null
    where round_id = target.id and rescue_requested_by = caller and id <> seat;

  update public.round_players
    set rescue_requested_by = caller, rescue_requested_at = now()
    where id = seat;
end;
$$;

-- ---------- the caddy's wave ----------
create function public.approve_seat_rescue(seat uuid)
returns void
language plpgsql
security definer set search_path = ''
volatile
as $$
declare
  seat_row public.round_players%rowtype;
begin
  select rp.* into seat_row
  from public.round_players rp
  where rp.id = seat
  for update;
  if not found then
    raise exception 'That card is not on any round';
  end if;

  if not public.is_round_official(seat_row.round_id) then
    raise exception 'Only the host or a caddy waves a player back in'
      using errcode = '42501';
  end if;
  if seat_row.rescue_requested_by is null then
    raise exception 'Nobody is waiting on that card';
  end if;
  if seat_row.role = 'host' then
    raise exception 'The host seat is fixed at creation' using errcode = '42501';
  end if;

  -- The knocker already holds it (an approve raced a rejoin): just tidy up.
  if seat_row.rescue_requested_by = seat_row.profile_id then
    update public.round_players
      set rescue_requested_by = null, rescue_requested_at = null
      where id = seat;
    return;
  end if;

  -- Re-checked at approval, not just at the knock: a claim or a duplicate
  -- join may have landed in between.
  if not exists (
    select 1 from auth.users u
    where u.id = seat_row.profile_id and u.is_anonymous
  ) then
    raise exception 'That card has been claimed — it signs back in with Google'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from public.round_players rp
    where rp.round_id = seat_row.round_id
      and rp.profile_id = seat_row.rescue_requested_by
  ) then
    raise exception 'They already hold a card in this round — strike the spare first'
      using errcode = '42501';
  end if;

  -- The one sanctioned hand-change; the guard trigger honours this setting
  -- for this transaction only.
  perform set_config('pubgolf.seat_rescue', '1', true);
  update public.round_players
    set profile_id = seat_row.rescue_requested_by,
        rescue_requested_by = null,
        rescue_requested_at = null
    where id = seat;
end;
$$;

-- ---------- "not them" ----------
create function public.dismiss_seat_rescue(seat uuid)
returns void
language plpgsql
security definer set search_path = ''
volatile
as $$
declare
  seat_row public.round_players%rowtype;
begin
  select rp.* into seat_row
  from public.round_players rp
  where rp.id = seat
  for update;
  if not found then
    raise exception 'That card is not on any round';
  end if;

  if not public.is_round_official(seat_row.round_id) then
    raise exception 'Only the host or a caddy turns a knock away'
      using errcode = '42501';
  end if;

  update public.round_players
    set rescue_requested_by = null, rescue_requested_at = null
    where id = seat;
end;
$$;

-- ---------- the broom ----------
-- Officials strike any non-host seat: the duplicate a broken cookie made,
-- or the stranger who wandered in with the code. Mirrors "hosts delete
-- rounds" — a policy, not a function, because DELETE needs no OLD-vs-NEW.
-- The host seat is never strikeable, by anyone, its own row included.
create policy "officials strike seats" on public.round_players
  for delete to authenticated
  using (public.is_round_official(round_id) and role <> 'host');

-- ---------- grants ----------
-- The seat list and the knock are for sessions only (anonymous ones count);
-- the signed-out anon role keeps reading nothing but the nameless card.
revoke execute on function
  public.get_round_seats (text),
  public.request_seat_rescue (text, uuid),
  public.approve_seat_rescue (uuid),
  public.dismiss_seat_rescue (uuid)
  from public, anon;

grant execute on function
  public.get_round_seats (text),
  public.request_seat_rescue (text, uuid),
  public.approve_seat_rescue (uuid),
  public.dismiss_seat_rescue (uuid)
  to authenticated;
