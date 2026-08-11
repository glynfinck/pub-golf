-- ---------------------------------------------------------------------------
-- Courses are counted, and the count is written down.
--
-- The first attempt at this made a fee hold one course at a time: tear it out
-- and plan another, free, for ever. That was forgiving and it was also
-- underivable — deleting the course erased the only evidence the allowance had
-- been used, so "how many courses did this fee buy?" had no answer the schema
-- could give. It never reached a database and has been folded into this file
-- rather than shipped and undone in the same release; a migration that creates
-- a trigger for its successor to drop is a story nobody should have to read.
--
-- A fee now buys a fixed number of courses and every one of them leaves a row.
-- Consumption is a fact, not a state: tearing the course out of the book does
-- not give the credit back, because the caddy already did the work and we
-- already paid for it.
--
-- **Consumed on a card, never on an ask.** The row is written when a *plan*
-- produces a card, so a refusal, a thin patch, a model error and a host who
-- closes the tab mid-plan all cost nothing. That is the same promise the
-- `failed` column keeps for money, kept here for credits.
--
-- **Rolls and tweaks are free.** They belong to a session that has already
-- spent its credit, and what bounds them is the budget (12% of the fee) and
-- fair use, both of which are about tokens. A host can worry a single course
-- all evening; starting a *new* one is what costs.
--
-- **Locked at expiry, used or not.** The fee is a day. A credit that outlived
-- its pass would be an indefinite one, which is the whole thing the day
-- boundary exists to prevent.
--
-- Additive per DEPLOYMENT.md: a new table, a new trigger and two new
-- functions. Code that has never heard of any of it goes on working, which
-- matters because Vercel and Supabase do not wait for each other — `liveFee`
-- already falls back to "any live fee" while this is missing.
-- ---------------------------------------------------------------------------

/** How many courses one green fee buys. Mirrored in lib/caddy/credits.ts and
 * proved equal by a db test — a number the screen misquotes is a host told
 * they have something they do not. */
create function public.caddy_courses_per_fee()
returns integer language sql immutable as $$ select 3 $$;

-- The unspent-fee lookup reads sessions by fee and wants an index for it.
create index if not exists caddy_sessions_entitlement_idx
  on public.caddy_sessions (entitlement_id)
  where entitlement_id is not null;

create table public.caddy_credits (
  id uuid primary key default gen_random_uuid(),
  -- The fee this was spent against. Cascades: a refunded fee takes its
  -- consumption record with it, which is right — there is no longer a purchase
  -- for the row to be an accounting of.
  entitlement_id uuid not null
    references public.entitlements (id) on delete cascade,
  host uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  -- Which conversation spent it. Nullable and `set null`, because the session
  -- may be tidied away long before the accounting stops mattering.
  session_id uuid references public.caddy_sessions (id) on delete set null,
  created_at timestamptz not null default now()
);

create index caddy_credits_entitlement_idx
  on public.caddy_credits (entitlement_id);

alter table public.caddy_credits enable row level security;

-- A host may read their own and write none. There is no insert policy at all:
-- the only author is the trigger below, running as definer, which is what
-- makes a credit something that happens *to* a host rather than something
-- they can decline to record.
create policy "caddy credits: read your own"
  on public.caddy_credits for select to authenticated
  using (host = (select auth.uid()));

grant select on public.caddy_credits to authenticated;

-- ---------------------------------------------------------------------------
-- Spend one, at the moment a plan produces a card.
--
-- On `caddy_turns` rather than on `caddy_sessions`, because the card arriving
-- is the event worth charging for and that is the row that records it. It also
-- puts the credit check inside the same insert the budget and fair-use guards
-- already gate, so a plan passes or fails all three together.
-- ---------------------------------------------------------------------------
create function public.guard_caddy_credit()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  fee record;
  spent integer;
begin
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  -- Only a plan that produced a card. A roll or a tweak belongs to a session
  -- that has already paid, and a failed turn costs money but never a credit.
  if new.kind is distinct from 'plan' or coalesce(new.failed, false) then
    return new;
  end if;

  select e.id, e.expires_at
    into fee
    from public.caddy_sessions s
    join public.entitlements e on e.id = s.entitlement_id
   where s.id = new.session_id;

  -- A session with no fee behind it is one whose fee was refunded. It cannot
  -- spend a credit because there is nothing left to spend.
  if fee.id is null then
    raise exception 'That green fee is no longer on the books'
      using errcode = '42501';
  end if;

  -- The day boundary, applied to the credit rather than only to the pass. An
  -- unused credit expires exactly as a used one does: the fee bought a day.
  if fee.expires_at is not null and fee.expires_at <= pg_catalog.now() then
    raise exception 'That green fee has run out'
      using errcode = '42501';
  end if;

  -- 20260816's scar again: a read-then-check allowance loses to concurrent
  -- writers under READ COMMITTED, and two tabs finishing a plan at once is
  -- exactly that shape. Keyed on the fee, so a host holding two spends them
  -- independently.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(fee.id::text, 0)
  );

  select count(*) into spent
    from public.caddy_credits c
   where c.entitlement_id = fee.id;

  if spent >= public.caddy_courses_per_fee() then
    raise exception 'This green fee has planned all its courses'
      using errcode = '42501';
  end if;

  insert into public.caddy_credits (entitlement_id, host, session_id)
  values (fee.id, new.host, new.session_id);

  return new;
end;
$$;

create trigger guard_caddy_credit
  before insert on public.caddy_turns
  for each row execute function public.guard_caddy_credit();

-- ---------------------------------------------------------------------------
-- What a host has left, and which fee to work under.
--
-- `caddy_unspent_fee` answers "which fee still has a course to give", and is
-- the one question the app asks about the allowance — `liveFee` picks the fee
-- to work under with it and `caddyAllowance` decides what to show. `or replace`
-- so a database that ran the folded-in holdings version locally is corrected
-- rather than erroring.
-- ---------------------------------------------------------------------------
create or replace function public.caddy_unspent_fee(who uuid)
returns uuid
language sql
stable
security definer set search_path = ''
as $$
  select e.id
    from public.entitlements e
   where e.user_id = who
     and e.kind = 'green_fee'
     and (e.expires_at is null or e.expires_at > pg_catalog.now())
     and (
       select count(*) from public.caddy_credits c where c.entitlement_id = e.id
     ) < public.caddy_courses_per_fee()
   -- Oldest first: spend the fee nearest expiry before one with longer to run,
   -- or a host who bought two wastes the first.
   order by e.expires_at asc nulls last
   limit 1;
$$;

/** Courses left across every live fee — what the screen tells a host. Zero for
 * somebody with no fee at all, which the screen distinguishes by asking
 * whether they hold one. */
create function public.caddy_credits_left(who uuid)
returns integer
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(sum(
           public.caddy_courses_per_fee()
           - (select count(*) from public.caddy_credits c where c.entitlement_id = e.id)
         ), 0)::integer
    from public.entitlements e
   where e.user_id = who
     and e.kind = 'green_fee'
     and (e.expires_at is null or e.expires_at > pg_catalog.now());
$$;

grant execute on function public.caddy_credits_left (uuid) to authenticated;

-- Belt and braces for anyone who ran the holdings version locally before it
-- was folded in above. Both `if exists`, so this is a no-op everywhere else.
drop trigger if exists guard_caddy_course_allowance on public.caddy_sessions;
drop function if exists public.guard_caddy_course_allowance ();
