-- ---------------------------------------------------------------------------
-- Five doors that were open, shut.
--
-- Found by an adversarial audit of the whole caddy branch. Every one of them is
-- the same mistake in a different costume: **a rule the application keeps that
-- Postgres does not**. Every action in this app reaches the database through
-- PostgREST on the caller's own session, so anything the client is trusted to
-- get right is something anyone with the network tab can get wrong on purpose.
--
-- Two of these shipped in the last day, on top of three that predate the caddy.
-- That is worth saying plainly rather than filing quietly: the newest one was
-- written *by* the migration that moved the day pass to tee-off, in the same
-- hour as a careful argument about why `holds_day_pass` needed no change.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Anyone could start anyone's day.
--
-- `activate_day_pass(who uuid)` is SECURITY DEFINER, takes an arbitrary uuid,
-- performs two writes and was granted to `authenticated`. It is an ordinary
-- PostgREST RPC and every guest holds `authenticated`, so one POST could burn a
-- stranger's green fee: start their 24 hours, and date every credit they had
-- not spent yet.
--
-- The migration that added it argued the exposure was small because it "names
-- no row and returns nothing". That is an argument about its *output*. The
-- danger was never what it tells you; it is what it writes.
--
-- The function stays as it is — the guard genuinely needs to activate a pass
-- for `rounds.host`, who is not always the caller (a caddy tees a round off on
-- the host's behalf, which is the whole reason `holds_day_pass` is definer
-- too). What changes is who may call it: nobody, by hand.
-- ---------------------------------------------------------------------------

revoke execute on function public.activate_day_pass(uuid) from public, anon, authenticated;
grant execute on function public.activate_day_pass(uuid) to service_role;

-- The guard is the only caller, so it now runs as owner in order to be one.
-- Making it definer does not widen what a host can do: its entire body is
-- refusals, and the one thing it now permits — starting a day — is the thing a
-- covered tee-off is *for*. The `authenticated` exemption at the top still
-- reads correctly, because `auth.jwt() ->> 'role'` is a property of the request
-- rather than of the executing role, and is unaffected by SECURITY DEFINER.
create or replace function public.guard_round_members()
returns trigger
language plpgsql
security definer set search_path = ''
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

  perform public.activate_day_pass(new.host);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 and 3. Anyone could read anyone's ledger.
--
-- `caddy_balance` and `caddy_next_grant` are SECURITY DEFINER with an arbitrary
-- `who`, granted to `authenticated`. Two POSTs told you how much caddy any
-- account on the stack was holding, and the second handed back a grant id.
--
-- What makes this worth a raised exception rather than a quiet zero: a silent
-- 0 is indistinguishable from a host with nothing left, and this is exactly the
-- kind of refusal somebody debugging their own screen needs to be able to see.
-- 42501 is the code every other guard here raises, so `expectDenied` knows it.
--
-- Both keep their signature. Every honest caller already passes its own uid —
-- `liveFee`, `caddyAllowance`, `guard_caddy_spend` — so this narrows nothing
-- that works today. service_role is exempt because the ledger's whole purpose
-- is to be readable by the house, and the db tier reads it back that way.
-- ---------------------------------------------------------------------------

create or replace function public.caddy_balance(who uuid, quota public.caddy_quota)
returns integer
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', current_user) = 'authenticated'
     and who is distinct from auth.uid() then
    raise exception 'A ledger belongs to its own host'
      using errcode = '42501';
  end if;
  return (
    select coalesce(sum(
             g.amount - (select count(*) from public.caddy_spends s where s.grant_id = g.id)
           ), 0)::integer
      from public.caddy_grants g
     where g.host = who
       and g.quota = caddy_balance.quota
       and (g.expires_at is null or g.expires_at > pg_catalog.now())
  );
end;
$$;

create or replace function public.caddy_next_grant(who uuid, quota public.caddy_quota)
returns uuid
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', current_user) = 'authenticated'
     and who is distinct from auth.uid() then
    raise exception 'A ledger belongs to its own host'
      using errcode = '42501';
  end if;
  return (
    select g.id
      from public.caddy_grants g
     where g.host = who
       and g.quota = caddy_next_grant.quota
       and (g.expires_at is null or g.expires_at > pg_catalog.now())
       and (select count(*) from public.caddy_spends s where s.grant_id = g.id) < g.amount
     order by g.expires_at asc nulls last, g.created_at asc
     limit 1
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Anyone could move any pub.
--
--   create policy "venues are refreshable" on public.venues
--     for update to authenticated using (true) with check (true);
--
-- `venues` is the shared Places cache every course and every round reads a pub's
-- name and coordinates out of. That policy let any signed-in account rename The
-- Old Blue Last, or move it a mile, **for everybody** — and `swapHolePub` and
-- `pinCoords` read those columns straight off the row onto a card.
--
-- This is the shortest path in the codebase to a group standing outside a door
-- that is not there, which is the failure this whole feature is built around
-- not causing.
--
-- The narrowing the comment above it described — "rating/fetched_at need to be
-- refreshable" — was never expressed anywhere but that comment. A policy cannot
-- express it either: `with check` sees only NEW, and "these columns may not
-- change" is a question about OLD. So it is a trigger, for the same reason the
-- role and handicap guards are triggers.
-- ---------------------------------------------------------------------------

create or replace function public.guard_venue_refresh()
returns trigger
language plpgsql
security invoker set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  -- What a refresh is allowed to be: how good a pub is and when we last looked.
  -- Everything that says *which pub it is* is fixed once the cache has it.
  if new.google_place_id is distinct from old.google_place_id
     or new.name is distinct from old.name
     or new.address is distinct from old.address
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng then
    raise exception 'A cached pub keeps its name and its address'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists venues_refresh_guard on public.venues;
create trigger venues_refresh_guard
  before update on public.venues
  for each row execute function public.guard_venue_refresh();

-- ---------------------------------------------------------------------------
-- 5. A session could be opened against a stranger's purchase.
--
-- The `caddy_sessions` INSERT policy checks `host = auth.uid()` and nothing
-- else. `entitlement_id` is constrained only by its foreign key — and **a
-- referential-integrity check runs with row security off**, so the FK happily
-- resolves a row the inserting user cannot see. Point a session at somebody
-- else's fee, file a course on it, and you have occupied the one-course slot of
-- a purchase you did not make.
--
-- `lib/actions/support.ts` asserts the opposite in a comment — "a stranger's id
-- would be refused by the constraint on a row they cannot read" — which is a
-- reasonable thing to assume about foreign keys and not how they behave.
--
-- A definer helper, because the check has to see rows the caller cannot: a
-- policy subquery over `entitlements` runs under the caller's own RLS and would
-- simply return nothing, which reads as "not yours" for everybody including the
-- owner.
-- ---------------------------------------------------------------------------

create or replace function public.owns_entitlement(purchase uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select purchase is null
      or exists (
        select 1 from public.entitlements e
         where e.id = purchase and e.user_id = auth.uid()
      );
$$;

revoke execute on function public.owns_entitlement(uuid) from public, anon;
grant execute on function public.owns_entitlement(uuid) to authenticated, service_role;

drop policy if exists "caddy sessions: start your own" on public.caddy_sessions;
create policy "caddy sessions: start your own" on public.caddy_sessions
  for insert to authenticated
  with check (
    host = (select auth.uid())
    and public.owns_entitlement(entitlement_id)
  );

-- The same shape on the report link, added in `20260910000000`: a report may
-- only name a conversation the reporter actually held.
create or replace function public.owns_caddy_session(session uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select session is null
      or exists (
        select 1 from public.caddy_sessions s
         where s.id = session and s.host = auth.uid()
      );
$$;

revoke execute on function public.owns_caddy_session(uuid) from public, anon;
grant execute on function public.owns_caddy_session(uuid) to authenticated, service_role;

drop policy if exists "bug reports: file your own" on public.bug_reports;
create policy "bug reports: file your own" on public.bug_reports
  for insert to authenticated
  with check (
    reporter = (select auth.uid())
    and public.owns_caddy_session(caddy_session_id)
  );
