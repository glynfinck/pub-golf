-- ---------------------------------------------------------------------------
-- A top-up grants what the tariff says it grants, whatever rung it is.
--
-- `caddy_topup_course` shipped and granted **nothing**. The purchase went
-- through, the entitlement row was written, and the buyer got no course, no
-- revision and no tweaks — money taken, nothing given, which is the worst
-- failure a billing path has.
--
-- The cause: `grant_caddy_package` decided whether a row was a top-up by
-- testing `new.kind` against a **hardcoded list** of the two rungs that
-- existed when it was written. `20260909000000` taught `caddy_topup_size` the
-- new rung and restated the CHECK so the row could be inserted at all, and
-- both of those were necessary — but the trigger in between went on saying "I
-- have never heard of that kind" and fell through to `return new`.
--
-- Worth naming the mistake precisely, because it was written down wrongly at
-- the time: that migration's own comment said `grant_caddy_package` "already
-- iterates `enum_range`, so the course grant is minted by the function below
-- rather than by any new branch". It does iterate `enum_range` — over
-- **quotas**, inside a branch it only reaches for a kind on the hardcoded
-- list. Iterating one axis is not iterating the other.
--
-- It is also the second time this exact shape has bitten: `caddy_topup_1`
-- first shipped unable to be inserted at all, because a different hardcoded
-- list — the CHECK constraint — had never heard of it either. A rung of the
-- tariff has to be added in several places, and every place that holds its own
-- copy of "which rungs exist" is a place that can be missed.
--
-- So this removes the last of those copies. The question the trigger asks
-- becomes **"does the tariff grant anything for this kind?"**, which
-- `caddy_topup_size` already answers and answers with 0 for anything it does
-- not recognise. Adding a rung is now genuinely one function plus the CHECK,
-- and the CHECK fails loudly at the door rather than silently after the money.
--
-- Additive per DEPLOYMENT.md: `create or replace` on a trigger function with an
-- unchanged signature. Every existing kind grants exactly what it granted
-- before — `caddy_topup_size` is unchanged and still returns the same numbers
-- for the same rungs.
-- ---------------------------------------------------------------------------

create or replace function public.grant_caddy_package()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  -- The fee: every quota at its package size, expiring with the pass. Note the
  -- expiry is whatever the row carries, which since `20260908000000` is null —
  -- a fee is dormant until a round tees off, and `activate_day_pass` dates
  -- these grants when it dates the fee.
  if new.kind = 'green_fee' then
    insert into public.caddy_grants (host, entitlement_id, quota, amount, expires_at, reason)
    select new.user_id, new.id, q, public.caddy_grant_size(q), new.expires_at, 'green_fee'
      from unnest(enum_range(null::public.caddy_quota)) as q;
    return new;
  end if;

  -- Any rung the tariff recognises, asked rather than listed. `caddy_topup_size`
  -- returns 0 for every quota of a kind it does not know, so an unrecognised
  -- purchase grants nothing — the same outcome as before for a genuinely
  -- unknown kind, without a second copy of "which rungs exist" to fall out of
  -- step with the first.
  if exists (
    select 1
      from unnest(enum_range(null::public.caddy_quota)) as q
     where public.caddy_topup_size(new.kind, q) > 0
  ) then
    -- Two differences from the fee, and they are the whole of what a top-up
    -- is. `expires_at` is null, so it outlives the night it was bought on —
    -- cost is incurred at redemption, so an unredeemed round costs nothing to
    -- hold and expiring one would earn breakage and nothing else. And the
    -- reason is the kind itself, so the ledger says which rung was sold.
    --
    -- Amounts of zero are skipped rather than inserted: a grant of nothing is
    -- not a fact worth recording, and it would show up in the balance query as
    -- a row that can never be spent.
    insert into public.caddy_grants (host, entitlement_id, quota, amount, expires_at, reason)
    select new.user_id, new.id, q, public.caddy_topup_size(new.kind, q), null, new.kind
      from unnest(enum_range(null::public.caddy_quota)) as q
     where public.caddy_topup_size(new.kind, q) > 0;
    return new;
  end if;

  return new;
end;
$$;

-- The rung that shipped granting nothing. Bounded to `caddy_topup_course` rows
-- that have no grants at all, so it cannot double-mint onto a purchase the
-- fixed trigger has already served, and it mints exactly what the trigger
-- would have. A refund still takes them: `caddy_grants.entitlement_id`
-- cascades since `20260903000000`.
insert into public.caddy_grants (host, entitlement_id, quota, amount, expires_at, reason)
select e.user_id, e.id, q, public.caddy_topup_size(e.kind, q), null, e.kind
  from public.entitlements e
 cross join unnest(enum_range(null::public.caddy_quota)) as q
 where e.kind = 'caddy_topup_course'
   and public.caddy_topup_size(e.kind, q) > 0
   and not exists (
     select 1 from public.caddy_grants g where g.entitlement_id = e.id
   );
