-- ---------------------------------------------------------------------------
-- The course a caddy session filed, so a refresh does not file a second one.
--
-- A caddy-planned course writes itself into the host's book the moment it
-- lands (`components/course/course-builder.tsx`), because the fee buys an
-- evening's legwork and legwork that lives only in a browser tab is one closed
-- tab from being bought twice. What it did not do was remember *which* course:
-- the id was React state, so a reloaded drafting table knew the session had
-- filed something and could not say what, and the next card minted another
-- one. Refresh twice, plan twice, three near-identical courses in the book.
--
-- One nullable column fixes it, and it is deliberately the smallest thing that
-- does. No new table, no second copy of the card — the turns already hold every
-- card this session produced, and `courses` already holds the filed one. This
-- is only the thread between them.
--
-- Additive, per DEPLOYMENT.md: Vercel and Supabase deploy independently, so
-- code that has never heard of this column must keep working. It does — the
-- column is nullable with no default and nothing reads it unless it is set.
-- ---------------------------------------------------------------------------

alter table public.caddy_sessions
  add column if not exists course_id uuid
    -- `set null`, never a cascade. A host who tears the course out of their
    -- book has not ended the conversation, and should not lose the dossier
    -- they are still working against — the same asymmetry the entitlement link
    -- on this table already keeps.
    references public.courses (id) on delete set null;

-- The host stamps this themselves, from their own session, immediately after
-- filing. That is a write, and `caddy_sessions` is deliberately writable only
-- one column at a time: the table's grant is what stops a host re-briefing a
-- session after its turns were charged, so the new column joins the grant
-- explicitly rather than the grant being widened to the whole row.
grant update (completed_at, dossier, course_id) on public.caddy_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- One way, like the bug report's issue stamp.
--
-- The session records which course it filed; it does not get to keep
-- re-pointing at a different one. Without this a host could walk the link
-- around their whole book, and the only thing that link is for is stopping a
-- duplicate — a mutable version of it would be a way to make one.
--
-- A trigger rather than a policy, for the reason the role and handicap guards
-- already document: `with check` only ever sees NEW, and "this may be set once"
-- is a question about OLD.
-- ---------------------------------------------------------------------------
create function public.guard_caddy_session_course()
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
    raise exception 'A caddy session keeps the course it filed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_caddy_session_course
  before update on public.caddy_sessions
  for each row execute function public.guard_caddy_session_course();
