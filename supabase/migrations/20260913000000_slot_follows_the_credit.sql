-- ---------------------------------------------------------------------------
-- A kept course follows the credit that paid for it, not the purchase.
--
-- `caddy_sessions_one_course_per_fee` — a unique partial index on
-- `entitlement_id` — was a proxy for the real rule, and the proxy leaked in
-- both directions.
--
--   **It let a rung that bought no course hold one.** `caddy_topup_1` is £5 for
--   a revision and ten tweaks and grants no `course` credit at all, but it is
--   its own entitlement, so under an index keyed on the purchase it got a slot
--   it never paid for.
--
--   **And it could not stop two tabs.** The drafting table mints the course
--   first and stamps the link afterwards, discarding the 23505 — so the index
--   refused the *link* while the duplicate course was already in the book. The
--   host ended up with two courses, one of them silently unattributed.
--
-- The rule that was always meant is simpler to say and truer to what was sold:
-- **a host may keep as many caddy courses as they have spent `course` credits.**
-- One fee spends one; a course top-up spends another; a revision spends none.
--
-- A trigger rather than an index or a policy, for the reason
-- `guard_score_mulligans` is a trigger: this is a count across sibling rows,
-- and `with check` can never see one. The advisory lock is 20260816's scar —
-- a read-then-check allowance loses to concurrent writers under READ
-- COMMITTED, and two tabs finishing at once is exactly that race.
--
-- Additive per DEPLOYMENT.md: a new trigger and a dropped index. Code that has
-- not deployed yet writes `course_id` exactly as before and meets a rule it
-- already satisfies — it has always filed one course per fee.
--
-- **One thing this does not do: grandfather.** A course filed before the
-- `course` quota existed (it arrived in `20260905000000`) has no course spend
-- behind it, so it counts against `held` while contributing nothing to
-- `paid_for` — and its host cannot file another until they spend a credit they
-- have not got. That is a real hazard and it is deliberately unhandled,
-- because there is no data it can reach: `main` has no caddy tables at all,
-- and the preview branch project is reset at merge. Backfilling a synthetic
-- grant and spend to paper over rows that are about to be deleted would be
-- machinery bought for nobody. **If that ceases to be true — if any
-- environment carries filed caddy courses across this migration — it needs
-- that backfill first.**
-- ---------------------------------------------------------------------------

drop index if exists public.caddy_sessions_one_course_per_fee;

create or replace function public.guard_caddy_course_slot()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  paid_for integer;
  held integer;
begin
  -- service_role seeds and tests; the same exemption every other guard carries.
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  -- Only a session *taking* a course is interesting. Releasing one — which is
  -- what the foreign key's own `on delete set null` does when a host tears the
  -- course out of the book — frees a slot and is never refused.
  if new.course_id is null
     or (tg_op = 'UPDATE' and new.course_id is not distinct from old.course_id) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.host::text || 'course', 0)
  );

  -- What they bought: every `course` credit this host has actually spent.
  -- Spends are the record of work done, so this counts purchases that produced
  -- a card rather than purchases that merely exist.
  select count(*) into paid_for
    from public.caddy_spends s
    join public.caddy_grants g on g.id = s.grant_id
   where s.host = new.host
     and g.quota = 'course';

  -- What they hold: courses already filed, excluding this row so an UPDATE
  -- that re-states the same link is not counted against itself.
  select count(*) into held
    from public.caddy_sessions cs
   where cs.host = new.host
     and cs.course_id is not null
     and cs.id is distinct from new.id;

  if held >= paid_for then
    raise exception 'That course credit is already holding a course'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists caddy_sessions_course_slot on public.caddy_sessions;
create trigger caddy_sessions_course_slot
  before insert or update on public.caddy_sessions
  for each row execute function public.guard_caddy_course_slot();

-- ---------------------------------------------------------------------------
-- Fair use stops competing with the thing a host actually bought.
--
-- The cap was 25 non-failed turns per rolling 24 hours. A green fee grants
-- 1 + 4 + 60 = 65 turns and its day is exactly 24 hours once activated, so a
-- host who teed off and then worked their card could not reach more than a
-- third of what they paid for — and the refusal they met said "the caddy's
-- done a full shift", which is not what happened.
--
-- Since `20260904000000` removed the money budget, `guard_caddy_spend` is the
-- ceiling that matters and fair use is only anti-script armour. Armour should
-- sit above everything an honest host can do, not through the middle of it.
-- ---------------------------------------------------------------------------

create or replace function public.caddy_fair_use_cap()
returns integer language sql immutable as $$ select 80 $$;
