-- ---------------------------------------------------------------------------
-- A third rung: another course, kept.
--
-- The two existing top-ups sell more *goes at the course in the book* — a
-- re-design is another attempt at the same card. Neither sells a second card
-- to keep, and since `caddy_sessions_one_course_per_fee` there is no way to
-- get one: the fee files its course and that is the host's lot.
--
-- That is right for the fee and wrong as a dead end. So this rung, and the
-- pleasing part is that it needs no exception written anywhere. **The
-- one-course rule is keyed on `entitlement_id`, which is to say it is per
-- purchase rather than per person** — so a course top-up is its own
-- entitlement and gets its own slot by the rule as it already stands.
--
-- The arithmetic, from docs/CADDY-TOPUPS.md's standing rule that the fee must
-- be the best rate anyone can get:
--
--   green fee   £12   5 cards   £2.40/card   60 tweaks (12/card)   + a round
--   this rung    £8   2 cards   £4.00/card   20 tweaks (10/card)
--   3-pack      £12   3 cards   £4.00/card   30 tweaks (10/card)
--   1-pack       £5   1 card    £5.00/card   10 tweaks (10/card)
--
-- The fee wins on every axis and is the only one that also covers the round
-- itself, so nothing here is the mug's option.
--
-- Note the revision this grants is load-bearing rather than generous.
-- `liveFee` decides which purchase a session works under by walking the same
-- ladder `guard_caddy_spend` spends on, and a rung granting a course and
-- nothing else would leave a host one card in with no way to revise it.
--
-- Additive per DEPLOYMENT.md: a restated CHECK and `create or replace` on one
-- immutable function. Code that has never heard of this kind keeps selling the
-- other two, and `grant_caddy_package` already iterates `enum_range`, so the
-- course grant is minted by the function below rather than by any new branch.
-- ---------------------------------------------------------------------------

-- The gate before the grant, restated whole — a CHECK has no ALTER, and this
-- constraint is small enough that saying it again is clearer than the
-- alternative. Without this the purchase dies at the door with 23514 and the
-- grant logic never runs, which is exactly how `caddy_topup_1` shipped broken.
alter table public.entitlements
  drop constraint if exists entitlements_kind_check;

alter table public.entitlements
  add constraint entitlements_kind_check
  check (kind = any (array[
    'green_fee',
    'season_ticket',
    'caddy_topup_1',
    'caddy_topup_3',
    'caddy_topup_course'
  ]));

/**
 * What each top-up grants, by entitlement kind and quota.
 *
 * Mirrored in `CADDY_TOPUPS` in lib/billing.ts and proved equal by a db test —
 * a number the screen misquotes is a host told they bought something they did
 * not.
 *
 * Returns 0 rather than null for a kind or quota this database does not
 * recognise, so an unknown purchase grants nothing instead of inserting a null
 * amount that would read as an unlimited grant. Note the two older rungs
 * return 0 for `course`, which is what keeps "more goes" and "another course"
 * different products.
 */
create or replace function public.caddy_topup_size(kind text, quota public.caddy_quota)
returns integer language sql immutable as $$
  select case kind
    when 'caddy_topup_1' then
      case quota when 'redesign' then 1 when 'tweak' then 10 else 0 end
    when 'caddy_topup_3' then
      case quota when 'redesign' then 3 when 'tweak' then 30 else 0 end
    when 'caddy_topup_course' then
      case quota when 'course' then 1 when 'redesign' then 1 when 'tweak' then 20 else 0 end
    else 0
  end;
$$;
