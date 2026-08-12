-- ---------------------------------------------------------------------------
-- The green fee, as a day pass.
--
-- The shape this settled on: a green fee is not bought for a round,
-- it is bought for a day. Every round its buyer hosts that tees off inside
-- the window gets the extras, and once a round has teed off covered it stays
-- covered forever — the pass expires (`entitlements.expires_at`, already on
-- the table), granted rounds don't. That asymmetry is the whole design: a
-- slow crawl crossing the 24-hour line and a refunded pass alike can never
-- brick a table that is already playing.
--
-- So the grant is not a row, it is a flag in the round's own ruleset
-- snapshot — read through `readRuleset` like mulligans and handicaps, checked
-- once at tee-off and never again. Which makes the flag the thing worth
-- attacking, and this migration is the answer to that: a BEFORE INSERT OR
-- UPDATE trigger admitting `members` only on the way up, only on an update,
-- and only while the round's host holds a live pass. The same OLD-vs-NEW
-- pattern as roles (20260809) and handicaps (20260810), and for the same
-- reason — WITH CHECK only ever sees NEW, and every rule here is about the
-- move from OLD to NEW rather than about the value that lands.
--
-- Note for anyone reading `entitlements_one_per_round` (20260821) alongside
-- this: a day pass carries `round_id` null, so that index no longer guards
-- green fees. Nothing needs it to. Two passes bought in one day is money the
-- house did not need to take rather than a hole — the action refuses it
-- politely, and the small print refunds it.
--
-- Additive: two functions and a trigger. Deployed code writes no `members`
-- key, so the guard has nothing to refuse until the app that sets it ships.
-- ---------------------------------------------------------------------------

-- ---------- 1. reading the flag, safely ----------
-- A ruleset is jsonb a host's browser once posted, so this never casts: a
-- `members` key holding the *string* "true", or a number, or an array, is
-- not the flag and must not raise 22P02 in the middle of a tee-off either.
create function public.ruleset_members(rules jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(rules -> 'members' = 'true'::jsonb, false);
$$;

-- ---------- 2. is this uid inside its window? ----------
-- SECURITY DEFINER because the caddy is the other person who tees a round
-- off, and a caddy cannot read the host's pass: a day pass is a user-scoped
-- entitlement row, and those are visible to their owner alone. What leaks is
-- one boolean about a uuid the asker already has to know — which for a round
-- is `rounds.host`, on a row they can already read.
--
-- `expires_at` null reads as live, matching the column's own contract
-- (null = never runs out) — that is how a granted or comped pass would work.
create function public.holds_day_pass(who uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.entitlements
    where user_id = who
      and kind = 'green_fee'
      and (expires_at is null or expires_at > now())
  );
$$;

revoke execute on function public.holds_day_pass(uuid) from public, anon;
grant execute on function public.holds_day_pass(uuid) to authenticated;

-- ---------- 3. the guard ----------
create function public.guard_round_members()
returns trigger
language plpgsql
security invoker set search_path = ''
as $$
declare
  wants boolean := public.ruleset_members(new.ruleset);
  had boolean := false;
begin
  -- service_role (the webhook, the seeder, the db fixtures) is not the
  -- attacker this guards against, and the same exemption every other guard
  -- on this table carries.
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    had := public.ruleset_members(old.ruleset);
  end if;
  -- The overwhelming case: a round being run, with nothing to police. Note
  -- this also lets every other ruleset key through untouched — the snapshot
  -- is history, and this trigger has an opinion about exactly one key.
  if wants = had then
    return new;
  end if;

  if not wants then
    -- Covered stays covered. Officials run a round; they do not repossess it,
    -- and the league would otherwise lose its rounds to a caddy's mistake.
    raise exception 'A covered round stays covered'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    -- A round is born uncovered, always. Creation is not the moment the doc
    -- picked — tee-off is — and letting the flag in here would hand a free
    -- league to anyone posting their own ruleset at the create endpoint.
    raise exception 'A round is not covered at creation — the green fee is stamped at tee-off'
      using errcode = '42501';
  end if;

  if not public.holds_day_pass(new.host) then
    raise exception 'The extras take a green fee — this round''s host holds no live pass'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger rounds_members_guard
  before insert or update on public.rounds
  for each row execute function public.guard_round_members();
