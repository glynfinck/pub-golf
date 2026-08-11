-- ---------------------------------------------------------------------------
-- More caddy, and the one thing on the board that does not expire.
--
-- The fee is a day pass: what it grants expires with it, honestly, because a
-- day pass is a day. A top-up is not that. Cost here is incurred entirely at
-- redemption — an unredeemed round costs nothing to hold on somebody's
-- account — so expiring one would earn breakage revenue and nothing else, and
-- breakage is what makes a brand feel mean. Beside a covenant that already
-- promises what's free stays free, it does not survive.
--
-- So the whole design is one column: top-up grants insert `expires_at` as
-- **null**. Everything downstream already handles it. `caddy_balance` and
-- `caddy_next_grant` both read `expires_at is null` as live, and
-- `caddy_next_grant` orders `expires_at asc nulls last`, so tonight's fee is
-- spent before a durable pack without a line of it changing.
--
-- Additive per DEPLOYMENT.md: a new function, and `create or replace` on a
-- trigger function whose signature is untouched. Code that has never heard of
-- a top-up keeps selling fees and reading balances exactly as before.
-- ---------------------------------------------------------------------------

/**
 * What each top-up grants, by entitlement kind and quota.
 *
 * The kind is the Stripe lookup key verbatim, so one string identifies a
 * purchase from Checkout through to the ledger row that pays for it. Mirrored
 * in `CADDY_TOPUPS` in lib/billing.ts and proved equal by a db test — a number
 * the screen misquotes is a host told they bought something they did not.
 *
 * Returns 0 rather than null for an unknown kind, so a purchase this database
 * does not recognise grants nothing instead of inserting a null amount that
 * would read as an unlimited grant.
 */
create function public.caddy_topup_size(kind text, quota public.caddy_quota)
returns integer language sql immutable as $$
  select case kind
    when 'caddy_topup_1' then case quota when 'redesign' then 1 when 'tweak' then 10 end
    when 'caddy_topup_3' then case quota when 'redesign' then 3 when 'tweak' then 30 end
    else 0
  end;
$$;

create or replace function public.grant_caddy_package()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  -- The fee: every quota at its package size, expiring with the pass.
  if new.kind = 'green_fee' then
    insert into public.caddy_grants (host, entitlement_id, quota, amount, expires_at, reason)
    select new.user_id, new.id, q, public.caddy_grant_size(q), new.expires_at, 'green_fee'
      from unnest(enum_range(null::public.caddy_quota)) as q;
    return new;
  end if;

  -- A top-up: the same shape, with two differences that are the entire point.
  -- `expires_at` is null, so it outlives the night it was bought on. And the
  -- reason is the kind itself, so the ledger says which rung was sold.
  --
  -- Amounts of zero are skipped rather than inserted. A grant of nothing is
  -- not a fact worth recording, and it would otherwise show up in the balance
  -- query as a row that can never be spent.
  if new.kind = any (array['caddy_topup_1', 'caddy_topup_3']) then
    insert into public.caddy_grants (host, entitlement_id, quota, amount, expires_at, reason)
    select new.user_id, new.id, q, public.caddy_topup_size(new.kind, q), null, new.kind
      from unnest(enum_range(null::public.caddy_quota)) as q
     where public.caddy_topup_size(new.kind, q) > 0;
    return new;
  end if;

  return new;
end;
$$;
