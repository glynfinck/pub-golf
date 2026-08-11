-- ---------------------------------------------------------------------------
-- One course a fee, and tearing it out buys the next one.
--
-- The hole this closes: a green fee bought twenty-four hours of caddy, and the
-- caddy could be asked for a course in Shoreditch, then Soho, then Camden,
-- keeping every one. Unbounded output for a fixed price. The fair-use ceiling
-- and the budget both bound the *tokens* a host can spend, which is the right
-- guard against a script, but neither bounds what a patient person keeps.
--
-- So the countable thing is the kept course. A fee may have exactly one caddy
-- course in the book at a time; edit it as much as you like, and if you tear
-- it out the fee is unspent again and the caddy will plan another.
--
-- The mechanism was already here. `caddy_sessions.course_id` is `on delete set
-- null` (20260827) — added so that tearing a course out would not also destroy
-- the conversation it came from — which means a deleted course frees its own
-- allowance with no bookkeeping and nothing to clean up. What is added here is
-- only the ceiling.
--
-- **Not a clawback.** Courses filed before this migration keep their place: the
-- guard refuses a *new* stamp, never an existing one, so nothing a host
-- already has can be taken away by deploying it.
--
-- Additive per DEPLOYMENT.md — a trigger and an index, no column changes, and
-- code that has never heard of it goes on working.
-- ---------------------------------------------------------------------------

-- The guard reads sessions by fee, and did not have an index for it.
create index if not exists caddy_sessions_entitlement_idx
  on public.caddy_sessions (entitlement_id)
  where entitlement_id is not null;

create function public.guard_caddy_course_allowance()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  taken integer;
begin
  -- service_role seeds and tests; the same exemption every other guard here
  -- carries.
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  -- Only the moment a session claims a course. Closing a session, dropping a
  -- dossier and the un-stamping a deleted course performs are all none of this
  -- trigger's business.
  if new.course_id is null or new.course_id is not distinct from old.course_id then
    return new;
  end if;

  -- A session with no fee behind it cannot spend one. `entitlement_id` is
  -- nullable because a refunded fee sets it null rather than deleting the
  -- host's drafts, and a session in that state is finished business.
  if new.entitlement_id is null then
    return new;
  end if;

  -- 20260816 is the precedent and the scar: a read-then-check allowance loses
  -- to concurrent writers, because two transactions under READ COMMITTED each
  -- take a snapshot without the other's uncommitted row and both decide there
  -- is room. Two tabs finishing a plan at once is exactly that shape.
  --
  -- Keyed on the entitlement rather than the host, so a host who has bought
  -- two fees can file both courses at once without one waiting on the other.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.entitlement_id::text, 0)
  );

  select count(*)
    into taken
    from public.caddy_sessions s
   where s.entitlement_id = new.entitlement_id
     and s.id is distinct from new.id
     and s.course_id is not null;

  if taken > 0 then
    raise exception 'This green fee already has its course'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_caddy_course_allowance
  before update on public.caddy_sessions
  for each row execute function public.guard_caddy_course_allowance();

-- ---------------------------------------------------------------------------
-- Which of a host's live fees still has its course to give.
--
-- Definer, and deliberately: `entitlements` shows a round-less row to its
-- buyer alone, and the caddy tees rounds off on other people's behalf — the
-- same reason `holds_day_pass` is a definer function rather than a policy read.
--
-- Returns the oldest unspent fee rather than the newest, so a host who bought
-- two spends the one nearer expiry first. The alternative wastes a fee.
-- ---------------------------------------------------------------------------
create function public.caddy_unspent_fee(who uuid)
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
     and not exists (
       select 1
         from public.caddy_sessions s
        where s.entitlement_id = e.id
          and s.course_id is not null
     )
   order by e.expires_at asc nulls last
   limit 1;
$$;

grant execute on function public.caddy_unspent_fee (uuid) to authenticated;
