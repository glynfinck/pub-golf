-- ---------------------------------------------------------------------------
-- The caddy's ledger: what a host was given, and what they have used.
--
-- Two quotas, because the two things a host asks for differ in cost by an
-- order of magnitude. A **re-design** is a fresh Places gather, a forty-pub
-- dossier written into cache and a tool loop; a **tweak** is a cached prefix
-- and one short call. Sharing one allowance meant two expensive plans ate the
-- whole of the tweaking budget — so "ask as often as you like", the loudest
-- promise the caddy makes, was being consumed by the thing next to it.
--
-- Counted in **actions**, never in tokens. A host who paid for a re-design gets
-- a whole re-design; what it costs in tokens is ours to absorb, which is what
-- a fixed price is *for*. Work is bounded by turns — an honest bound the caddy
-- is told about — and the variance between a lucky plan and an unlucky one is
-- the seller's problem, not the buyer's.
--
-- ## Why two tables
--
-- A single ledger of signed deltas (+3 granted, −1 spent) is tidier and wrong.
-- Only *grants* expire. Sum the deltas over live rows and an expired grant's
-- +3 drops out while its −1 spends remain, and the host goes negative — owing
-- courses to a fee that is over. Grants and spends have different lifetimes,
-- so they are different tables, and a balance is always read as
-- "live grants, minus what was spent against them".
--
-- ## The two writers
--
-- Neither is the host. A **grant** is written by the fulfilment path as
-- `service_role` — it is a purchase, and the only thing entitled to say a
-- purchase happened is the thing that saw the money. A **spend** is written by
-- a definer trigger at the moment an action succeeds. The host may read both
-- and write neither, which is what makes a balance something that happens *to*
-- them rather than something they can decline to record.
--
-- ## Time
--
-- A grant carries its own expiry, inherited from the fee that bought it, and
-- locks at that moment whether it was used or not. An unspent credit outliving
-- its pass would be an indefinite one, which is the whole reason a day
-- boundary exists. Expiry is a fair limit in a way truncation is not: it is
-- knowable in advance, identical for everybody, and it takes nothing away from
-- work already done — every course a fee planned stays the host's for good.
--
-- Per-grant rather than read off `entitlements` so a top-up can carry its own
-- window later without this table learning anything new.
-- ---------------------------------------------------------------------------

create type public.caddy_quota as enum ('redesign', 'tweak');

/** What one green fee grants of each quota. Mirrored in lib/caddy/credits.ts
 * and proved equal by a db test — a number the screen misquotes is a host told
 * they have something they do not.
 *
 * Re-designs are the countable thing a host buys. Tweaks are set where a real
 * evening never reaches them: the allowance exists so a runaway script meets
 * something, not so a fussy host does. */
create function public.caddy_grant_size(quota public.caddy_quota)
returns integer language sql immutable as $$
  select case quota when 'redesign' then 3 when 'tweak' then 60 end
$$;

create table public.caddy_grants (
  id uuid primary key default gen_random_uuid(),
  host uuid not null references public.profiles (id) on delete cascade,
  -- The purchase behind it. Nullable and `set null`: a refunded fee must not
  -- delete the record that a grant once existed, because spends still point at
  -- it and the accounting has to survive the refund that ended it.
  entitlement_id uuid references public.entitlements (id) on delete set null,
  quota public.caddy_quota not null,
  amount integer not null check (amount > 0),
  -- Null never expires. Every grant a green fee makes carries the fee's own
  -- day; the column is nullable so a future grant that genuinely should not
  -- expire needs no migration.
  expires_at timestamptz,
  /** Why this exists — 'green_fee', later a top-up SKU. Free text with no
   * check: a new reason must never be a non-additive migration. */
  reason text not null default 'green_fee',
  created_at timestamptz not null default now()
);

create index caddy_grants_live_idx
  on public.caddy_grants (host, quota, expires_at);

create table public.caddy_spends (
  id uuid primary key default gen_random_uuid(),
  -- Which grant it came out of. Cascades, because a spend against a grant that
  -- no longer exists is not an accounting record, it is a dangling fact.
  grant_id uuid not null references public.caddy_grants (id) on delete cascade,
  host uuid not null references public.profiles (id) on delete cascade,
  -- What it bought. Both nullable and both `set null`: the conversation may be
  -- tidied away long before the accounting stops mattering.
  session_id uuid references public.caddy_sessions (id) on delete set null,
  turn_id uuid references public.caddy_turns (id) on delete set null,
  created_at timestamptz not null default now()
);

create index caddy_spends_grant_idx on public.caddy_spends (grant_id);

alter table public.caddy_grants enable row level security;
alter table public.caddy_spends enable row level security;

-- Read your own, write neither. There is no insert policy on either table:
-- grants come from fulfilment as service_role, spends from the trigger below
-- as definer.
create policy "caddy grants: read your own"
  on public.caddy_grants for select to authenticated
  using (host = (select auth.uid()));

create policy "caddy spends: read your own"
  on public.caddy_spends for select to authenticated
  using (host = (select auth.uid()));

grant select on public.caddy_grants to authenticated;
grant select on public.caddy_spends to authenticated;

-- ---------------------------------------------------------------------------
-- The balance, and the grant to spend next.
-- ---------------------------------------------------------------------------

/** How many actions of one quota a host still holds. Live grants only, minus
 * what has been spent against them — never a signed sum, for the reason at the
 * top of this file. */
create function public.caddy_balance(who uuid, quota public.caddy_quota)
returns integer
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(sum(
           g.amount - (select count(*) from public.caddy_spends s where s.grant_id = g.id)
         ), 0)::integer
    from public.caddy_grants g
   where g.host = who
     and g.quota = caddy_balance.quota
     and (g.expires_at is null or g.expires_at > pg_catalog.now());
$$;

/** The grant to spend from, oldest expiry first so nothing is wasted. */
create function public.caddy_next_grant(who uuid, quota public.caddy_quota)
returns uuid
language sql
stable
security definer set search_path = ''
as $$
  select g.id
    from public.caddy_grants g
   where g.host = who
     and g.quota = caddy_next_grant.quota
     and (g.expires_at is null or g.expires_at > pg_catalog.now())
     and (select count(*) from public.caddy_spends s where s.grant_id = g.id) < g.amount
   order by g.expires_at asc nulls last, g.created_at asc
   limit 1;
$$;

grant execute on function public.caddy_balance (uuid, public.caddy_quota) to authenticated;
grant execute on function public.caddy_next_grant (uuid, public.caddy_quota) to authenticated;

-- ---------------------------------------------------------------------------
-- Spend one, when an action succeeds.
--
-- On `caddy_turns` because the card arriving is the event worth charging for
-- and that is the row recording it — which also puts this check inside the
-- same insert fair use already gates, so an action passes or fails both
-- together.
-- ---------------------------------------------------------------------------
create function public.guard_caddy_spend()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  wanted public.caddy_quota;
  chosen uuid;
begin
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  -- A turn that produced no card costs money and never a credit — the same
  -- promise the `failed` column keeps. A plan is a re-design; a roll is one
  -- too, because it produces a different course from the same patch. Only a
  -- tweak is a tweak.
  if coalesce(new.failed, false) then
    return new;
  end if;
  wanted := case when new.kind = 'tweak' then 'tweak' else 'redesign' end;

  -- 20260816's scar: a read-then-check allowance loses to concurrent writers
  -- under READ COMMITTED, and two tabs finishing at once is exactly that
  -- shape. Keyed on host and quota, so a re-design never waits on a tweak.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.host::text || wanted::text, 0)
  );

  chosen := public.caddy_next_grant(new.host, wanted);
  if chosen is null then
    raise exception 'No % left on this green fee', wanted
      using errcode = '42501';
  end if;

  insert into public.caddy_spends (grant_id, host, session_id, turn_id)
  values (chosen, new.host, new.session_id, new.id);

  return new;
end;
$$;

-- AFTER, not BEFORE: a spend points at the turn that caused it, and the turn
-- has no id to point at until it exists. Still inside the transaction, so a
-- refusal here still rolls the turn back.
create trigger guard_caddy_spend
  after insert on public.caddy_turns
  for each row execute function public.guard_caddy_spend();

-- ---------------------------------------------------------------------------
-- A green fee grants its package.
--
-- On `entitlements` rather than in the webhook's application code, so a fee
-- cannot exist without its grants — the two are one transaction, and there is
-- no window in which a host has paid and holds nothing.
-- ---------------------------------------------------------------------------
create function public.grant_caddy_package()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.kind is distinct from 'green_fee' then
    return new;
  end if;
  insert into public.caddy_grants (host, entitlement_id, quota, amount, expires_at, reason)
  select new.user_id, new.id, q, public.caddy_grant_size(q), new.expires_at, 'green_fee'
    from unnest(enum_range(null::public.caddy_quota)) as q;
  return new;
end;
$$;

create trigger grant_caddy_package
  after insert on public.entitlements
  for each row execute function public.grant_caddy_package();
