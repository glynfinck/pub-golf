-- ---------------------------------------------------------------------------
-- The green fee's day starts when the round does, not when the card is charged.
--
-- The fee is a day pass and the day ran from *purchase*. But a fee is consumed
-- at two moments that are rarely the same day: planning, which people do in
-- advance, and playing, which is a specific evening. Buy on Wednesday to plan a
-- Saturday crawl and the pass was dead by Thursday — the host had paid for
-- extras their round would never get, and nothing on the way in said so.
--
-- Worth noting how little the clock was holding up. The caddy half is bounded
-- by *counts* now — one course, four revisions, sixty tweaks — so the clock
-- adds nothing there. The round half is `guard_round_members` stamping
-- `members` once, at tee-off, which is naturally a count too. And the argument
-- for not holding Google's data indefinitely is answered somewhere else
-- entirely, by the twelve-hour dossier window in `lib/caddy/window.ts`. The
-- clock was the product's framing rather than any rule's requirement.
--
-- So the fee lies dormant until a round tees off, and the day it buys is the
-- day you play. That is a more honest reading of "day pass" than the old one,
-- and it needs nothing from the host — no date at checkout, no activation
-- button, no way to get it wrong.
--
-- **`holds_day_pass` is untouched, and that is the neat part.** It already
-- reads `expires_at is null` as live, matching the column's own contract, so a
-- dormant fee covers its holder without a single change to the guard, the
-- policies, or the app's reading of it. What changes is only when a date gets
-- written.
--
-- Additive per DEPLOYMENT.md, in both directions of the deploy race. Old code
-- writing `expires_at` at purchase produces a fee that behaves exactly as
-- today. New code writing null against a database without this migration
-- produces a fee that never expires — generous rather than broken, and bounded
-- by the credits either way.
-- ---------------------------------------------------------------------------

alter table public.entitlements
  add column if not exists activated_at timestamptz;

comment on column public.entitlements.activated_at is
  'When the day pass was started by a round teeing off. Null means dormant: '
  'bought and not yet used, covering its holder with no clock running.';

-- Every fee sold before this migration was dated at purchase, so it is already
-- running and has been since it was bought. Stamping `created_at` says exactly
-- that and keeps their behaviour identical — the alternative, leaving them
-- null, would claim they had never been started while `expires_at` said
-- otherwise.
update public.entitlements
   set activated_at = created_at
 where kind = 'green_fee'
   and expires_at is not null
   and activated_at is null;

/**
 * How long the day lasts once it starts. Mirrored by `DAY_PASS_HOURS` in
 * lib/billing.ts and proved equal by a test — the two decide the same thing
 * from different sides, and a host whose screen and database disagree about
 * when their pass ends has been lied to by one of them.
 */
create or replace function public.day_pass_hours()
returns integer language sql immutable as $$ select 24 $$;

/**
 * Start the dormant pass, if there is one.
 *
 * SECURITY DEFINER for the same reason `holds_day_pass` is one: the caddy tees
 * rounds off too, and a caddy cannot write the host's entitlement row. What
 * this exposes is narrower than that function already does — it names no row
 * and returns nothing.
 *
 * The *oldest* dormant fee, so somebody holding two spends the one they bought
 * first. Idempotent by construction: it only ever matches a row with a null
 * `activated_at`, so a second tee-off on the same night finds nothing to do
 * and the day keeps running from the first.
 *
 * The grants move with it. They were minted durable — `grant_caddy_package`
 * copies the entitlement's expiry, and a dormant fee has none — so without
 * this the credits would outlive the day they belong to.
 */
create or replace function public.activate_day_pass(who uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  fee uuid;
  runs_out timestamptz := pg_catalog.now()
    + (public.day_pass_hours() || ' hours')::interval;
begin
  select id into fee
    from public.entitlements
   where user_id = who
     and kind = 'green_fee'
     and activated_at is null
   order by created_at asc
   limit 1;
  if fee is null then
    return;
  end if;

  update public.entitlements
     set activated_at = pg_catalog.now(),
         expires_at = runs_out
   where id = fee;

  -- Only the ones this fee minted, and only the ones with no expiry of their
  -- own. A durable top-up grant is not the fee's to end.
  update public.caddy_grants
     set expires_at = runs_out
   where entitlement_id = fee
     and expires_at is null;
end;
$$;

revoke execute on function public.activate_day_pass(uuid) from public, anon;
grant execute on function public.activate_day_pass(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tee-off is the moment, so the guard that already recognises it does the
-- starting.
--
-- Unchanged in every other respect — the same exemption, the same three
-- refusals, in the same order. The one new line runs after the pass has been
-- checked, so a round that is refused coverage never starts a day.
-- ---------------------------------------------------------------------------
create or replace function public.guard_round_members()
returns trigger
language plpgsql
security invoker set search_path = ''
as $$
declare
  wants boolean := public.ruleset_members(new.ruleset);
  had boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    had := public.ruleset_members(old.ruleset);
  end if;
  if wants = had then
    return new;
  end if;

  if not wants then
    -- Covered stays covered. Officials run a round; they do not repossess it.
    raise exception 'A covered round stays covered'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    raise exception 'A round is not covered at creation — the green fee is stamped at tee-off'
      using errcode = '42501';
  end if;

  if not public.holds_day_pass(new.host) then
    raise exception 'The extras take a green fee — this round''s host holds no live pass'
      using errcode = '42501';
  end if;

  -- The round is teeing off covered, which is the moment the fee was bought
  -- for. Start its day. A pass already running is untouched; a host with none
  -- dormant does nothing, and could not have reached this line anyway.
  perform public.activate_day_pass(new.host);

  return new;
end;
$$;
