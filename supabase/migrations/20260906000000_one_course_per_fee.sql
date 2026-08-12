-- ---------------------------------------------------------------------------
-- One course per green fee, counted and enforced.
--
-- `20260905000000` added the `course` quota. This is where it means something,
-- and it settles two questions the ledger has never answered.
--
-- **How many generations does a fee buy?** Five: the course, and four
-- revisions of it. That is what the fee has always been sold as and what it
-- has never granted — the first plan spent a re-design like any other, so
-- "one course plus four revisions" was really four goes in total.
--
-- **How many of them does a host keep?** One. This is the important half. A
-- revision is another attempt at the *same* course, not another course; four
-- of them amounting to four saved courses would be a fee buying four evenings'
-- work for the price of one. Nothing said so, and on preview a single fee has
-- already produced two.
--
-- The rule is one line — a unique index — and it lands here rather than in the
-- drafting table because the drafting table is where it was, in React state,
-- and React state is lost on a reload. The specific failure: `resumeCaddy`
-- answers with the host's *most recent* session, but the course link may sit
-- on an older one, so a host who planned twice got a null back and the next
-- card minted a second course. Every version of that bug is a client
-- forgetting something Postgres already knows.
--
-- Compatible per DEPLOYMENT.md: `create or replace` on two functions with
-- unchanged signatures, plus an index. Code that has not deployed yet keeps
-- spending re-designs and never notices the course quota; code that has keeps
-- working against a database without the index, because it does not rely on
-- the refusal — it asks which course the fee already filed and writes over it.
-- ---------------------------------------------------------------------------

-- What a green fee grants of each quota. One course, four revisions of it,
-- sixty tweaks. `grant_caddy_package` iterates `enum_range`, so adding the
-- value in the previous migration is what makes this row get minted at all —
-- and returning null for an unknown quota would insert a null amount that
-- reads as an unlimited grant, so every arm is spelled out.
create or replace function public.caddy_grant_size(quota public.caddy_quota)
returns integer language sql immutable as $$
  select case quota
    when 'course' then 1
    when 'redesign' then 4
    when 'tweak' then 60
  end
$$;

-- Live fees minted before this migration have no course grant at all, and
-- would otherwise spend a re-design on their first plan — which is the old
-- arithmetic, and one generation short of what they were sold. Bounded to
-- unexpired green-fee grants, and to hosts who have not already been given
-- one, so it cannot double-mint.
insert into public.caddy_grants (host, entitlement_id, quota, amount, expires_at, reason)
select g.host, g.entitlement_id, 'course', 1, g.expires_at, g.reason
  from public.caddy_grants g
 where g.quota = 'redesign'
   and g.reason = 'green_fee'
   and (g.expires_at is null or g.expires_at > now())
   and not exists (
     select 1 from public.caddy_grants c
      where c.entitlement_id = g.entitlement_id
        and c.quota = 'course'
   );

-- ---------------------------------------------------------------------------
-- Spend the course first, then the revisions.
--
-- A plan and a roll both produce a whole card, so both draw on the same
-- ladder: the course credit if one is unspent, a re-design otherwise. That
-- ordering is what makes "one course plus four revisions" true without a
-- second code path — the first generation of a fee takes the course, every
-- later one takes a revision, and a host who tears their course out and plans
-- again spends a revision exactly as they would to re-roll it.
--
-- The refusal names the ladder's bottom rung rather than the rung it tried, so
-- a host who has run out is told they are out of revisions rather than out of
-- something they never knew they had.
-- ---------------------------------------------------------------------------
create or replace function public.guard_caddy_spend()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  chosen uuid;
begin
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  -- A turn that produced no card costs money and never a credit — the same
  -- promise the `failed` column keeps.
  if coalesce(new.failed, false) then
    return new;
  end if;

  -- 20260816's scar: a read-then-check allowance loses to concurrent writers
  -- under READ COMMITTED, and two tabs finishing at once is exactly that
  -- shape. One lock for the whole non-tweak ladder, so a plan racing a roll
  -- cannot take the course credit twice; tweaks keep their own, so a tweak
  -- never waits on a re-design.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.host::text || case when new.kind = 'tweak' then 'tweak' else 'card' end,
      0
    )
  );

  if new.kind = 'tweak' then
    chosen := public.caddy_next_grant(new.host, 'tweak');
    if chosen is null then
      raise exception 'No tweaks left on this green fee'
        using errcode = '42501';
    end if;
  else
    chosen := public.caddy_next_grant(new.host, 'course');
    if chosen is null then
      chosen := public.caddy_next_grant(new.host, 'redesign');
    end if;
    if chosen is null then
      raise exception 'No revisions left on this green fee'
        using errcode = '42501';
    end if;
  end if;

  insert into public.caddy_spends (grant_id, host, session_id, turn_id)
  values (chosen, new.host, new.session_id, new.id);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The rule itself: a fee files one course.
--
-- Repaired before it is enforced, because the index cannot be created over
-- data that already breaks it and a migration that fails is an outage.
--
-- What the repair drops is the *link*, never a course. A course already in
-- somebody's book is theirs — the covenant says what's free stays free and a
-- filed card is more than free, it is paid for — so both survive and both stay
-- editable by hand. The earliest-filed one keeps its session, because that is
-- the course the fee actually bought; the later ones simply stop counting
-- against it, and read from then on like any hand-plotted course.
-- ---------------------------------------------------------------------------
update public.caddy_sessions s
   set course_id = null
 where s.course_id is not null
   and s.entitlement_id is not null
   and exists (
     select 1
       from public.caddy_sessions keeper
      where keeper.entitlement_id = s.entitlement_id
        and keeper.course_id is not null
        and (keeper.created_at, keeper.id) < (s.created_at, s.id)
   );

-- Nulls are distinct in a unique index, so a session with no fee behind it —
-- there are none today, but the column is nullable — is not constrained by
-- this, and neither is a session that has filed nothing. The whole rule is the
-- `where`: at most one *filed* course per fee.
--
-- And the release valve is already in place: `caddy_sessions.course_id` is
-- `on delete set null`, so tearing the course out of the book frees the fee to
-- file another. That is deliberate rather than incidental — a host who does
-- not like what they got should be able to bin it and spend a revision on
-- something else, and this is what lets them.
create unique index if not exists caddy_sessions_one_course_per_fee
  on public.caddy_sessions (entitlement_id)
  where course_id is not null;
