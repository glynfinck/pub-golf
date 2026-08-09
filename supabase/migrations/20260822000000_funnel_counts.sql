-- ---------------------------------------------------------------------------
-- Phase one of the tariff: the denominators.
--
-- MONETIZATION.md gates every later decision on rates — tips per finished
-- round, green fees per round created, recap shares per finished round — and
-- a rate is useless without the number underneath it. This migration is the
-- number underneath it, and it is deliberately the smallest thing that could
-- work: no events table, no analytics vendor, no second copy of the truth.
--
-- Three of the four moments are already facts in this schema and are counted
-- where they lie: `rounds.created_at` is a round created, `round_players
-- .joined_at` (minus the host's own seat, which is the creation) is a round
-- joined, and filing a card now stamps `rounds.finished_at`. Only the fourth
-- leaves no trace — sharing a recap is a tap on the phone that never reaches
-- Postgres — so it gets one integer on the round it belongs to, bumped
-- through a SECURITY DEFINER function because a guest may share the card and
-- a guest may not update a round.
--
-- Additive throughout: two nullable/defaulted columns and two functions.
-- Deployed code reads none of it, so this can land ahead of the app
-- (DEPLOYMENT.md — the two integrations do not wait for each other).
-- ---------------------------------------------------------------------------

-- ---------- 1. when the card was filed ----------
-- Status already says *whether* a round finished; nothing said *when*, and a
-- funnel measured over a window needs the instant, not the state.
alter table public.rounds
  add column finished_at timestamptz,
  add column recap_shares integer not null default 0
    check (recap_shares >= 0);

-- Rounds filed before this migration have exactly one timestamp to their
-- name. A round is an evening, so its creation is within hours of its filing
-- — close enough to keep the back-history in the funnel, and honest about
-- being an approximation. Everything filed from here is stamped for real.
update public.rounds
  set finished_at = created_at
  where status = 'finished' and finished_at is null;

-- A stamp, not an app responsibility: `advanceHole` past the last hole and
-- `fileCardEarly` both file a card, `reopenHole` un-files one, and a fourth
-- path would forget. The lowest layer that can hold the rule holds it.
--
-- Both columns are *derived*, never submitted. finished_at is computed from
-- the status transition, so whatever a caller sent is overwritten; and the
-- share counter only moves for `record_recap_share`, which announces itself
-- with a transaction-local setting nothing else sets — the same door the
-- seat-rescue guard uses (20260818). Officials update a round all night
-- (tee off, call the hole, reset the timer) and not one of those is a share,
-- so without this the caddy's every tap could rewrite the house's books.
create function public.stamp_round_books()
returns trigger
language plpgsql
security invoker set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.finished_at := case when new.status = 'finished' then now() end;
    -- Nobody has shared a round that does not exist yet.
    new.recap_shares := 0;
    return new;
  end if;

  if new.status = 'finished' and old.status is distinct from 'finished' then
    new.finished_at := now();
  elsif new.status is distinct from 'finished' then
    -- Reopened, or never filed: a card in play has no filing time. Teeing it
    -- up and filing again stamps the filing that actually stands.
    new.finished_at := null;
  else
    new.finished_at := old.finished_at;
  end if;

  if coalesce(current_setting('pubgolf.recap_share', true), '') <> 'on' then
    new.recap_shares := old.recap_shares;
  end if;
  return new;
end;
$$;

create trigger rounds_books_stamp
  before insert or update on public.rounds
  for each row execute function public.stamp_round_books();

-- ---------- 2. a recap, shared ----------
-- The whole table shares the card, guests included, and a guest cannot
-- update a round — the officials-only policy is exactly right and stays.
-- So the counter moves through a definer function that admits members only.
-- Deliberately a plain counter and not a distinct-sharer count: the metric
-- the doc asks for is shares per finished round, and a second share to a
-- second group chat is a second share.
create function public.record_recap_share(join_code text)
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  target uuid;
  total integer;
begin
  select id into target from public.rounds where code = upper(join_code);
  if target is null then
    raise exception 'No round with that code' using errcode = 'P0002';
  end if;
  if not public.is_round_member(target) then
    raise exception 'Only the table shares its own card'
      using errcode = '42501';
  end if;

  -- Transaction-local, and the only thing that sets it: this is what the
  -- books trigger above lets the counter through on.
  perform set_config('pubgolf.recap_share', 'on', true);
  update public.rounds
    set recap_shares = recap_shares + 1
    where id = target
    returning recap_shares into total;
  return total;
end;
$$;

revoke execute on function public.record_recap_share(text) from public, anon;
grant execute on function public.record_recap_share(text) to authenticated;

-- ---------- 3. the house's own books ----------
-- One row, five numbers, over any window. Not a player-facing surface: how
-- many rounds the house ran is the house's business, so the grant goes to
-- service_role alone and a signed-in player asking is refused outright.
--
-- `recaps_shared` sums over rounds *filed* in the window rather than shared
-- in it — the counter carries no timestamp of its own, and the rate the doc
-- wants is shares per finished round, which is exactly this pairing.
create function public.house_funnel(
  since timestamptz default '-infinity',
  until timestamptz default 'infinity'
)
returns table (
  rounds_created bigint,
  rounds_joined bigint,
  rounds_finished bigint,
  recaps_shared bigint,
  green_fees bigint
)
language sql
stable
security definer set search_path = ''
as $$
  select
    (select count(*) from public.rounds
      where created_at >= since and created_at < until),
    -- The host's own seat is the round being created, not somebody joining
    -- it; counting it would flatter the join rate by exactly one per round.
    (select count(*) from public.round_players
      where role <> 'host' and joined_at >= since and joined_at < until),
    (select count(*) from public.rounds
      where finished_at >= since and finished_at < until),
    (select coalesce(sum(recap_shares), 0) from public.rounds
      where finished_at >= since and finished_at < until),
    (select count(*) from public.entitlements
      where kind = 'green_fee' and created_at >= since and created_at < until);
$$;

revoke execute on function public.house_funnel(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.house_funnel(timestamptz, timestamptz)
  to service_role;
