-- ---------------------------------------------------------------------------
-- A caddy course is archived, not torn out.
--
-- Courses have always been deletable, and that was fine while every course was
-- free to remake. It stopped being fine the moment a course cost a credit: a
-- host who tears one out now loses the course *and* the credit that made it,
-- from a button whose whole affordance is "this is undoable-ish". Hold to
-- confirm is a speed bump, not a receipt.
--
-- So a course that cost something goes to the back of the book instead of into
-- the bin, and can be brought forward again. The row survives, which also
-- keeps the accounting honest: `caddy_credits` can still point at the session
-- that spent it, and "what did this fee produce" stays answerable.
--
-- One column, nullable, additive. Code that has never heard of it sees every
-- course exactly as before — which is the DEPLOYMENT.md rule, and here it also
-- means the archive degrades to "nothing is archived" rather than to an
-- outage.
-- ---------------------------------------------------------------------------

alter table public.courses
  add column if not exists archived_at timestamptz;

-- Partial, because the book only ever queries for the live ones and archived
-- courses are the rare tail.
create index if not exists courses_owner_live_idx
  on public.courses (owner, created_at desc)
  where archived_at is null;

-- Archiving and restoring are ordinary owner updates — `courses` already has
-- an owner-scoped update policy, and this column joins it rather than needing
-- a door of its own. Deleting stays possible and stays the owner's right: what
-- changes is which button the drafting table offers for a course that cost a
-- credit, not what the database permits. A host who genuinely wants a paid
-- course gone can still have it gone.
