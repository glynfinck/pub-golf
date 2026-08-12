-- ---------------------------------------------------------------------------
-- A host may tear out a course the caddy planned. Until now they could not.
--
-- `20260827000000` made the session→course link one-way, and rightly: the link
-- exists to stop a duplicate, and a movable one would be a way to make one.
-- What it missed is that the link is also nulled by something other than a
-- host — the foreign key's own `on delete set null`, when the course is torn
-- out of the book.
--
-- That referential action runs as an AFTER DELETE on `courses`, inside the
-- host's own request, where `auth.jwt() ->> 'role'` is still `authenticated`.
-- So the guard fired on it, saw a `course_id` going from something to nothing,
-- and refused — meaning **every caddy-planned course was undeletable**, with
-- the host told "A caddy session keeps the course it filed" for pressing a
-- button about their own book.
--
-- It hid because nothing tested a delete of a caddy course specifically, and
-- because the sentence sounds like a rule rather than a bug.
--
-- This matters more now than it did: `caddy_sessions_one_course_per_fee` makes
-- tearing the course out the *only* way to free a fee to plan a different one.
-- The release valve was welded shut.
--
-- The fix keeps the rule and narrows it to what it was always about. Re-pointing
-- at a different course is still refused. Nulling is allowed **only when the
-- course is genuinely gone**, which a host cannot fake: they would have to
-- delete it, which is the thing being permitted. So the column grant on
-- `course_id` still cannot be used to walk the link around the book.
--
-- Additive per DEPLOYMENT.md: `create or replace` on a trigger function with an
-- unchanged signature. Code either side of the deploy writes `caddy_sessions`
-- exactly as before; the only difference is that a delete now succeeds.
-- ---------------------------------------------------------------------------

create or replace function public.guard_caddy_session_course()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  -- service_role seeds and tests; the same exemption every other guard on this
  -- stack carries.
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  if old.course_id is not null and new.course_id is distinct from old.course_id then
    -- The course was torn out of the book, and this update is the foreign key
    -- clearing up after it rather than the host re-pointing at something else.
    -- Checked by looking, not by trusting the shape: the row is already gone
    -- by the time an `on delete set null` action fires, so its absence is the
    -- thing that distinguishes the two cases.
    if new.course_id is null
       and not exists (
         select 1 from public.courses c where c.id = old.course_id
       ) then
      return new;
    end if;

    raise exception 'A caddy session keeps the course it filed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
