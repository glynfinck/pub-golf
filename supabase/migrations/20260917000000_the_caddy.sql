-- ---------------------------------------------------------------------------
-- The caddy, as one migration.
--
-- Twenty-two files landed on `claude/pub-golf-caddy-spec-ydipz4` between
-- `20260825` and `20260916`, and a good number of them undid each other: a
-- whole `caddy_credits` table born and buried inside three days, a one-course
-- rule keyed on the purchase and then re-keyed on the credit, ten functions
-- replaced two and three times each. That history is in the git log, where
-- history belongs. What a database needs is the answer.
--
-- **This file is the twenty-two, with the dead ends taken out.** Every body
-- below is the final version of that object, lifted verbatim from the file
-- that last defined it — so what runs here is byte-for-byte what was applied
-- to the preview project and probed there, one migration at a time.
--
-- Three things were decided rather than derived, and they are the only places
-- this differs from replaying all twenty-two:
--
--   **`caddy_budget_micropence()` is gone.** `20260904000000` removed the
--   money budget from `guard_caddy_fair_use`, which was its only caller, and
--   it went on returning a figure derived from the £4 launch fee — three times
--   out of step with `caddyBudgetMicroPence()` in TypeScript, which is live as
--   the tool loop's runaway breaker. A db test asserted the two were equal.
--   The SQL copy is the dead one.
--
--   **`caddy_quota` is created with all three values.** It shipped as
--   `('redesign', 'tweak')` and gained `'course'` in its own migration,
--   because `alter type ... add value` cannot run in the transaction that
--   created the type. In one file it must be one statement, and the order is
--   preserved because `caddy_next_grant` reads it.
--
--   **The backfills are gone.** Four `update`/`insert` statements repaired
--   rows that existed on the branch project mid-flight. A squash runs from
--   empty and has nothing to repair.
--
-- Each of the twenty-two carried an argument for what it did, and those
-- arguments are the valuable part — they are preserved in the comments below,
-- which is why this file is long.
--
-- Verified before it landed: every object it creates matches the preview
-- project's own inventory after the twenty-two (4 tables, 20 functions less
-- the dropped one, 6 triggers, 8 policies, 9 indexes, 1 enum), and every name
-- a policy or a trigger resolves at creation time is defined above its use.
-- CI proves the rest — `supabase db reset` applies this from empty and the
-- db, stress and e2e tiers run against the result.
-- ---------------------------------------------------------------------------

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

create table public.caddy_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Defaulted rather than merely checked: the row is the host's own by
  -- construction, and the policies below have nothing to disagree with.
  host uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  -- Which green fee this session was worked under. Nullable because a session
  -- outlives the entitlement row it was started on — a refunded or expired
  -- fee must never retrospectively delete a host's drafts, which is the same
  -- "covered stays covered" asymmetry 20260823 already establishes.
  entitlement_id uuid references public.entitlements (id) on delete set null,
  -- What the host asked for: where, the pins, holes, vibe, particulars, note.
  -- Read through lib/caddy/brief.ts's readBrief and never cast inline.
  brief jsonb not null default '{}'::jsonb
    check (jsonb_typeof(brief) = 'object' and char_length(brief::text) <= 4000),
  -- The candidate pubs, as the caddy was briefed on them. Bounded generously
  -- because forty dossiers with review snippets is a real amount of text, and
  -- cheaply because it is deleted the moment the session completes.
  dossier jsonb not null default '[]'::jsonb
    check (jsonb_typeof(dossier) = 'array' and char_length(dossier::text) <= 200000),
  -- Stamped when a course is saved off this session. The dossier is emptied at
  -- the same moment: Google's atmosphere facts and review snippets are read
  -- for the length of one conversation and are not ours to keep.
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index caddy_sessions_host_recent_idx
  on public.caddy_sessions (host, created_at desc);

create table public.caddy_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.caddy_sessions (id) on delete cascade,
  -- Denormalised from the session so fair use can be counted without a join,
  -- and so the trigger below can take its lock without reading another table.
  host uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  -- plan is the first card, roll is a fresh one from the same patch, tweak is
  -- an answer to something the host said. Free text with a check rather than
  -- an enum: a fourth kind later must not be a non-additive migration.
  kind text not null default 'plan'
    check (kind in ('plan', 'roll', 'tweak')),
  -- What the host said, on a tweak. Their own words, bounded; fenced on the
  -- way into the prompt by lib/caddy/plan.ts, never here.
  ask text check (ask is null or char_length(ask) <= 200),
  -- The card this turn produced: the resolved holes, already hung on real
  -- venue ids. A row exists only where a card arrived — a refusal, a cancel
  -- and a model error write nothing, which is why none of them count.
  result jsonb not null
    check (jsonb_typeof(result) = 'object' and char_length(result::text) <= 100000),
  created_at timestamptz not null default now()
);

create index caddy_turns_session_idx
  on public.caddy_turns (session_id, created_at);

-- The index the fair-use count runs on.
create index caddy_turns_host_recent_idx
  on public.caddy_turns (host, created_at desc);

alter table public.caddy_sessions enable row level security;

alter table public.caddy_turns enable row level security;

-- Your own sessions, and only ever your own. There is no official's view and
-- no member's view: a brief is the host's working notes, and the course they
-- eventually save is the only part anybody else was ever meant to see.
create policy "caddy sessions: read your own"
  on public.caddy_sessions for select to authenticated
  using (host = (select auth.uid()));

-- Completing a session — stamping completed_at and emptying the dossier — is
-- done by the host's own session, because every write in this app reaches
-- Postgres as the player. The column grant below is what keeps that from
-- becoming "a host may rewrite their brief".
create policy "caddy sessions: complete your own"
  on public.caddy_sessions for update to authenticated
  using (host = (select auth.uid()))
  with check (host = (select auth.uid()));

create policy "caddy turns: read your own"
  on public.caddy_turns for select to authenticated
  using (host = (select auth.uid()));

-- Insert only, and only onto a session you own. There is no update policy and
-- no delete policy on purpose: a turn is a fact about what happened, and a
-- host who could delete turns could reclaim fair use by tidying up after
-- themselves.
create policy "caddy turns: append to your own session"
  on public.caddy_turns for insert to authenticated
  with check (
    host = (select auth.uid())
    and exists (
      select 1 from public.caddy_sessions s
       where s.id = session_id and s.host = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- The budget stops being a ceiling. Cost stays evidence.
--
-- `guard_caddy_fair_use` enforced two unrelated things: a turn count, which is
-- volume and a fair backstop, and a *money* budget at 12% of the fee, which
-- was a second meter on a purchase the host had already made.
--
-- The second one refused a paying host tonight. A fee buys four re-designs;
-- the budget stopped the third, with a sentence about a full shift that named
-- no number and predicted nothing. That is the worst kind of refusal — the
-- host cannot see it coming, cannot act on it, and has already paid.
--
-- The reasoning is the same that removed the per-conversation token cap
-- before it: **what a host was told bounds the work, and nothing else does.**
-- They were told four re-designs and sixty tweaks. Those are counts they can
-- see. What a plan costs us varies, and absorbing that variance is what a
-- fixed price is for; metering it twice means the fourth course a host bought
-- can be refused for reasons that are ours rather than theirs.
--
-- What is left, and why each is different from a budget:
--   * the re-design and tweak quotas — what was actually sold, and countable
--   * fair use below — volume, aimed at a script rather than at an evening
--   * the runaway breaker in the loop — an incident detector, not a ceiling
--
-- `cost_micropence` is still computed on every row, and that is deliberate: it
-- is what prices the tariff. Evidence, not a gate.
--
-- Additive per DEPLOYMENT.md: `create or replace` on an existing trigger
-- function, same signature. `caddy_budget_micropence` is left in place — it is
-- read by nothing now, but dropping a function while the old code is still
-- deployed is how a live outage happens, and it costs nothing to leave.
-- ---------------------------------------------------------------------------

create or replace function public.guard_caddy_fair_use()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  turns integer;
  cap integer := public.caddy_fair_use_cap();
begin
  -- The cost is ours to compute, not the caller's to declare — unchanged, and
  -- more important than ever now that it is the only thing this records.
  -- Done before the service_role exemption so a seeded row carries a truthful
  -- bill and the pricing evidence is never a caller's opinion.
  new.cost_micropence := public.caddy_cost_micropence(
    new.model,
    new.input_tokens,
    new.output_tokens,
    new.cache_write_tokens,
    new.cache_read_tokens
  );

  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.host::text, 0)
  );

  -- Turns only. A card consumes a turn; what it cost is written down and not
  -- weighed against anything.
  select count(*) filter (where not t.failed)
    into turns
    from public.caddy_turns t
   where t.host = new.host
     and t.created_at > pg_catalog.now() - interval '24 hours';

  if turns >= cap then
    raise exception 'The caddy has done a full shift on this fee (% turns in 24 hours)', cap
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_caddy_fair_use
  before insert on public.caddy_turns
  for each row execute function public.guard_caddy_fair_use();

-- ---------------------------------------------------------------------------
-- The Data API gate init.sql warned about — new tables are not auto-exposed,
-- and the whole db tier goes dark the moment one is missed. `anon` is granted
-- nothing at all: no signed-out surface queries these tables (planning needs a
-- signed-in host, and a guest is an anonymous *user*, not the anon role), so a
-- 42501 there is the honest answer rather than a policy quietly returning zero
-- rows. service_role rides 20260811's default privileges.
-- ---------------------------------------------------------------------------
grant select, insert on public.caddy_sessions to authenticated;

-- Column-level, and the reason the update policy above is safe: completing a
-- session is the only thing a session may ever write after the insert. The
-- brief and the dossier are what the model was actually given, so they stay
-- exactly as they were posted.
grant update (completed_at, dossier) on public.caddy_sessions to authenticated;

grant select, insert on public.caddy_turns to authenticated;

grant execute on function public.caddy_fair_use_cap ()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The caddy's bill, and the ceiling on it.
--
-- 20260825 rationed the caddy by *turns*: twenty-five in a rolling day. That is
-- the right armour against a script and the wrong meter for money, because a
-- turn is not a fixed quantity. An eighteen-hole plan over a forty-pub dossier,
-- with a tool loop behind it, costs an order of magnitude more than "make hole
-- three quieter" — and counting both as one turn prices neither. Twenty-five of
-- the expensive kind against a single green fee is a loss on that fee.
--
-- So the fee now buys an allowance in money, and the turn cap stays underneath
-- it. They guard different things and both are wanted:
--
--   the turn cap  — armour against a script. Bounds an adversary who lies about
--                   what their calls cost, because it does not ask.
--   the budget    — margin against honest heavy use. Bounds the host who really
--                   did roll thirty cards, each one real and each one billed.
--
-- WHAT THE CLIENT IS TRUSTED WITH: the token counts, and nothing else. Every
-- write in this app reaches Postgres on the caller's own session, so a host
-- could post whatever numbers they like. Two things make that survivable. The
-- cost is *recomputed here* from the tokens and never read from the request, so
-- the arithmetic cannot be forged, only its inputs. And a host who forges the
-- inputs downward is a script, which is what the turn cap above is for — it
-- does not care what they claim. The budget is therefore honest about who it
-- is for: the heavy user, not the attacker.
--
-- Note also what the shape of the table already denies. 20260825 gave turns no
-- update policy and no delete policy, so this ledger is append-only: a host can
-- add rows but never edit or remove one. Since cost is computed from what
-- arrives and rows only accumulate, the sum a host can reach by hand-writing
-- rows is strictly *larger* than their true bill, never smaller. The only
-- forgery available to them charges them more.
--
-- Additive in the way DEPLOYMENT.md requires. Every new column defaults, so the
-- code already deployed keeps inserting turns exactly as it does today; those
-- rows simply record no spend and the budget never binds on them, while the
-- turn cap continues to. The migration can land ahead of the code.
-- ---------------------------------------------------------------------------

alter table public.caddy_turns
  -- Which model answered, because the price depends on it. Text rather than an
  -- enum, and it keeps the gateway's provider prefix if there was one — the
  -- price lookup below strips it, and the raw id is worth having verbatim when
  -- somebody is reading these rows to find out what actually ran.
  add column if not exists model text not null default 'claude-opus-5',
  -- The four lines of a Messages API bill. Bounded well above anything one call
  -- can physically produce (max_tokens is 8k, the dossier a few tens of
  -- thousands) so a fat-fingered or forged number cannot land as a plausible
  -- one — and cannot overflow the sum below either.
  add column if not exists input_tokens integer not null default 0
    check (input_tokens >= 0 and input_tokens <= 2000000),
  add column if not exists output_tokens integer not null default 0
    check (output_tokens >= 0 and output_tokens <= 2000000),
  add column if not exists cache_write_tokens integer not null default 0
    check (cache_write_tokens >= 0 and cache_write_tokens <= 2000000),
  add column if not exists cache_read_tokens integer not null default 0
    check (cache_read_tokens >= 0 and cache_read_tokens <= 2000000),
  -- Derived, never accepted. The trigger overwrites whatever arrives here.
  add column if not exists cost_micropence bigint not null default 0
    check (cost_micropence >= 0),
  -- A call that produced no usable card. It still burned tokens — a refusal, a
  -- malformed answer and a short card are all fully billed by the vendor — so
  -- the money has to be recorded somewhere or failures are the one unmetered
  -- way to spend. 20260825 wrote no row at all for these, which kept the
  -- host's promise ("a failure never counts") by making the spend invisible.
  --
  -- Now the row is written and the promise is kept honestly instead: the two
  -- counts below read different sets. The budget sums *every* row, because we
  -- really did pay for it. The turn cap counts only rows that produced a card,
  -- because what the host was promised is that a failure does not use up a
  -- card — never that it consumed no electricity.
  add column if not exists failed boolean not null default false;

-- ---------------------------------------------------------------------------
-- The price board, in micropence per token.
--
-- Mirrored in lib/caddy/budget.ts, which is the copy the app estimates and
-- displays from; this is the copy that *enforces*. A db test calls both and
-- proves they agree, the same arrangement caddy_fair_use_cap() and
-- bug_report_daily_cap() already use.
--
-- Micropence per token equals pence per million tokens — a million tokens at a
-- dollar is a hundred pence, so a token is a hundred millionths of one. That is
-- why these are whole numbers with no scaling factor to get backwards, and why
-- the whole sum stays in integers.
-- ---------------------------------------------------------------------------
create function public.caddy_cost_micropence(
  model text,
  input_tokens integer,
  output_tokens integer,
  cache_write_tokens integer,
  cache_read_tokens integer
)
returns bigint
language sql
immutable
as $$
  with bare as (
    -- The gateway carries the provider on the id; the price is the model's.
    select case
             when position('/' in model) > 0
               then substring(model from position('/' in model) + 1)
             else model
           end as id
  ),
  price as (
    select *
      from (values
        -- id,                          input, output, write, read
        ('claude-opus-5',                 400,   2000,   500,   40),
        ('claude-sonnet-5',               240,   1200,   300,   24),
        ('claude-haiku-4-5-20251001',      80,    400,   100,    8)
      ) as p (id, input_rate, output_rate, write_rate, read_rate)
     where p.id = (select id from bare)
     union all
    -- An unknown model bills at the dearest tier we know, never at nothing.
    -- Free is the one wrong answer: it would make a typo, a new release or a
    -- gateway alias silently uncapped, which is what this guards against.
    select 'unknown', 400, 2000, 500, 40
     where not exists (
       select 1 from (values
         ('claude-opus-5'), ('claude-sonnet-5'), ('claude-haiku-4-5-20251001')
       ) as k (id) where k.id = (select id from bare)
     )
  )
  select coalesce(input_tokens, 0)::bigint * input_rate
       + coalesce(output_tokens, 0)::bigint * output_rate
       + coalesce(cache_write_tokens, 0)::bigint * write_rate
       + coalesce(cache_read_tokens, 0)::bigint * read_rate
    from price
   limit 1
$$;

grant execute on function public.caddy_cost_micropence (text, integer, integer, integer, integer)
  to anon, authenticated, service_role;

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

create trigger guard_caddy_session_course
  before update on public.caddy_sessions
  for each row execute function public.guard_caddy_session_course();

-- The unspent-fee lookup reads sessions by fee and wants an index for it.
create index if not exists caddy_sessions_entitlement_idx
  on public.caddy_sessions (entitlement_id)
  where entitlement_id is not null;

-- Belt and braces for anyone who ran the holdings version locally before it
-- was folded in above. Both `if exists`, so this is a no-op everywhere else.
drop trigger if exists guard_caddy_course_allowance on public.caddy_sessions;

drop function if exists public.guard_caddy_course_allowance ();

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
-- keeps the accounting honest: `caddy_spends` can still point at the session
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

create type public.caddy_quota as enum ('redesign', 'tweak', 'course');

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

create table public.caddy_grants (
  id uuid primary key default gen_random_uuid(),
  host uuid not null references public.profiles (id) on delete cascade,
  -- The purchase behind it. Nullable and `set null`: a refunded fee must not
  -- delete the record that a grant once existed, because spends still point at
  -- it and the accounting has to survive the refund that ended it.
  entitlement_id uuid references public.entitlements (id) on delete set null,
  quota public.caddy_quota not null,
  amount integer not null check (amount > 0),
  -- Null never expires. Every grant a green fee makes carries the fee's own
  -- day; the column is nullable so a future grant that genuinely should not
  -- expire needs no migration.
  expires_at timestamptz,
  /** Why this exists — 'green_fee', later a top-up SKU. Free text with no
   * check: a new reason must never be a non-additive migration. */
  reason text not null default 'green_fee',
  created_at timestamptz not null default now()
);

create index caddy_grants_live_idx
  on public.caddy_grants (host, quota, expires_at);

create table public.caddy_spends (
  id uuid primary key default gen_random_uuid(),
  -- Which grant it came out of. Cascades, because a spend against a grant that
  -- no longer exists is not an accounting record, it is a dangling fact.
  grant_id uuid not null references public.caddy_grants (id) on delete cascade,
  host uuid not null references public.profiles (id) on delete cascade,
  -- What it bought. Both nullable and both `set null`: the conversation may be
  -- tidied away long before the accounting stops mattering.
  session_id uuid references public.caddy_sessions (id) on delete set null,
  turn_id uuid references public.caddy_turns (id) on delete set null,
  created_at timestamptz not null default now()
);

create index caddy_spends_grant_idx on public.caddy_spends (grant_id);

alter table public.caddy_grants enable row level security;

alter table public.caddy_spends enable row level security;

-- Read your own, write neither. There is no insert policy on either table:
-- grants come from fulfilment as service_role, spends from the trigger below
-- as definer.
create policy "caddy grants: read your own"
  on public.caddy_grants for select to authenticated
  using (host = (select auth.uid()));

create policy "caddy spends: read your own"
  on public.caddy_spends for select to authenticated
  using (host = (select auth.uid()));

grant select on public.caddy_grants to authenticated;

grant select on public.caddy_spends to authenticated;

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

grant execute on function public.caddy_balance (uuid, public.caddy_quota) to authenticated;

grant execute on function public.caddy_next_grant (uuid, public.caddy_quota) to authenticated;

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

-- AFTER, not BEFORE: a spend points at the turn that caused it, and the turn
-- has no id to point at until it exists. Still inside the transaction, so a
-- refusal here still rolls the turn back.
create trigger guard_caddy_spend
  after insert on public.caddy_turns
  for each row execute function public.guard_caddy_spend();

-- ---------------------------------------------------------------------------
-- A top-up grants what the tariff says it grants, whatever rung it is.
--
-- `caddy_topup_course` shipped and granted **nothing**. The purchase went
-- through, the entitlement row was written, and the buyer got no course, no
-- revision and no tweaks — money taken, nothing given, which is the worst
-- failure a billing path has.
--
-- The cause: `grant_caddy_package` decided whether a row was a top-up by
-- testing `new.kind` against a **hardcoded list** of the two rungs that
-- existed when it was written. `20260909000000` taught `caddy_topup_size` the
-- new rung and restated the CHECK so the row could be inserted at all, and
-- both of those were necessary — but the trigger in between went on saying "I
-- have never heard of that kind" and fell through to `return new`.
--
-- Worth naming the mistake precisely, because it was written down wrongly at
-- the time: that migration's own comment said `grant_caddy_package` "already
-- iterates `enum_range`, so the course grant is minted by the function below
-- rather than by any new branch". It does iterate `enum_range` — over
-- **quotas**, inside a branch it only reaches for a kind on the hardcoded
-- list. Iterating one axis is not iterating the other.
--
-- It is also the second time this exact shape has bitten: `caddy_topup_1`
-- first shipped unable to be inserted at all, because a different hardcoded
-- list — the CHECK constraint — had never heard of it either. A rung of the
-- tariff has to be added in several places, and every place that holds its own
-- copy of "which rungs exist" is a place that can be missed.
--
-- So this removes the last of those copies. The question the trigger asks
-- becomes **"does the tariff grant anything for this kind?"**, which
-- `caddy_topup_size` already answers and answers with 0 for anything it does
-- not recognise. Adding a rung is now genuinely one function plus the CHECK,
-- and the CHECK fails loudly at the door rather than silently after the money.
--
-- Additive per DEPLOYMENT.md: `create or replace` on a trigger function with an
-- unchanged signature. Every existing kind grants exactly what it granted
-- before — `caddy_topup_size` is unchanged and still returns the same numbers
-- for the same rungs.
-- ---------------------------------------------------------------------------

create or replace function public.grant_caddy_package()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  -- The fee: every quota at its package size, expiring with the pass. Note the
  -- expiry is whatever the row carries, which since `20260908000000` is null —
  -- a fee is dormant until a round tees off, and `activate_day_pass` dates
  -- these grants when it dates the fee.
  if new.kind = 'green_fee' then
    insert into public.caddy_grants (host, entitlement_id, quota, amount, expires_at, reason)
    select new.user_id, new.id, q, public.caddy_grant_size(q), new.expires_at, 'green_fee'
      from unnest(enum_range(null::public.caddy_quota)) as q;
    return new;
  end if;

  -- Any rung the tariff recognises, asked rather than listed. `caddy_topup_size`
  -- returns 0 for every quota of a kind it does not know, so an unrecognised
  -- purchase grants nothing — the same outcome as before for a genuinely
  -- unknown kind, without a second copy of "which rungs exist" to fall out of
  -- step with the first.
  if exists (
    select 1
      from unnest(enum_range(null::public.caddy_quota)) as q
     where public.caddy_topup_size(new.kind, q) > 0
  ) then
    -- Two differences from the fee, and they are the whole of what a top-up
    -- is. `expires_at` is null, so it outlives the night it was bought on —
    -- cost is incurred at redemption, so an unredeemed round costs nothing to
    -- hold and expiring one would earn breakage and nothing else. And the
    -- reason is the kind itself, so the ledger says which rung was sold.
    --
    -- Amounts of zero are skipped rather than inserted: a grant of nothing is
    -- not a fact worth recording, and it would show up in the balance query as
    -- a row that can never be spent.
    insert into public.caddy_grants (host, entitlement_id, quota, amount, expires_at, reason)
    select new.user_id, new.id, q, public.caddy_topup_size(new.kind, q), null, new.kind
      from unnest(enum_range(null::public.caddy_quota)) as q
     where public.caddy_topup_size(new.kind, q) > 0;
    return new;
  end if;

  return new;
end;
$$;

create trigger grant_caddy_package
  after insert on public.entitlements
  for each row execute function public.grant_caddy_package();

-- ---------------------------------------------------------------------------
-- More caddy, and the one thing on the board that does not expire.
--
-- The fee is a day pass: what it grants expires with it, honestly, because a
-- day pass is a day. A top-up is not that. Cost here is incurred entirely at
-- redemption — an unredeemed round costs nothing to hold on somebody's
-- account — so expiring one would earn breakage revenue and nothing else, and
-- breakage is what makes a brand feel mean. Beside a covenant that already
-- promises what's free stays free, it does not survive.
--
-- So the whole design is one column: top-up grants insert `expires_at` as
-- **null**. Everything downstream already handles it. `caddy_balance` and
-- `caddy_next_grant` both read `expires_at is null` as live, and
-- `caddy_next_grant` orders `expires_at asc nulls last`, so tonight's fee is
-- spent before a durable pack without a line of it changing.
--
-- Additive per DEPLOYMENT.md: a new function, and `create or replace` on a
-- trigger function whose signature is untouched. Code that has never heard of
-- a top-up keeps selling fees and reading balances exactly as before.
-- ---------------------------------------------------------------------------

-- The gate before the grant. `entitlements.kind` is CHECK-constrained to the
-- kinds that existed when the table was written, so without this a top-up
-- entitlement cannot be inserted at all and the trigger below never fires —
-- the grant logic would be perfect and the purchase would 23514 at the door.
--
-- Found by inserting one against the preview database rather than by reading
-- this file, which is the argument for the end-to-end check in a sentence.
--
-- Dropped and recreated rather than added to: a CHECK has no ALTER, and the
-- constraint is small enough that restating it whole is clearer than the
-- alternative. `if exists` so a database that never had it is not an error.
alter table public.entitlements
  drop constraint if exists entitlements_kind_check;

alter table public.entitlements
  add constraint entitlements_kind_check
  check (kind = any (array[
    'green_fee',
    'season_ticket',
    'caddy_topup_1',
    'caddy_topup_3'
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

-- ---------------------------------------------------------------------------
-- A refunded purchase takes its rounds with it.
--
-- `caddy_grants.entitlement_id` was `on delete set null`, which orphaned a
-- grant rather than removing it. That was survivable while every grant carried
-- a green fee's expiry — an orphan died on its own clock inside the day, and
-- the row stayed as a record of what had been given.
--
-- Durable top-ups ended that. A top-up grant has no expiry by design, so an
-- orphan is immortal: refund the purchase and keep the rounds for ever. It is
-- also, more quietly, wrong for the fee — a refund inside the window left the
-- pass's rounds spendable until the clock ran out.
--
-- Cascade is the fix, and the accounting objection to it does not survive
-- inspection. The worry was losing the record of what a purchase produced, but
-- that record is not here: `caddy_turns` holds the model, the tokens and the
-- recomputed cost, and it references the *session*, not the grant. It is
-- untouched by this. What cascades is `caddy_spends`, which is the counter
-- that decides a balance — and once the purchase is refunded there is no
-- balance for it to decide. Grant and spends go together, the balance returns
-- to what it would have been, and nothing can go negative.
--
-- `entitlement_id` stays nullable. Nothing writes a null today, but a comped
-- grant is the obvious future one, and making it required would be a promise
-- this migration has no reason to make.
--
-- Compatible per DEPLOYMENT.md: a foreign key's delete rule, not a column.
-- PostgREST sees the same shape before and after, so a deploy that lands
-- either side of this reads and writes `caddy_grants` exactly as it did.
-- ---------------------------------------------------------------------------

alter table public.caddy_grants
  drop constraint if exists caddy_grants_entitlement_id_fkey;

alter table public.caddy_grants
  add constraint caddy_grants_entitlement_id_fkey
  foreign key (entitlement_id)
  references public.entitlements (id)
  on delete cascade;

-- The orphans the old rule already made. There is no purchase behind these and
-- no way to tell what they were for, so they cannot be honoured — and a
-- durable one would otherwise be honoured for ever. Bounded to rows that are
-- already orphaned; a grant with a purchase behind it is untouched.
delete from public.caddy_grants where entitlement_id is null;

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
-- The arithmetic, from the standing rule that the fee must
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
-- other two.
--
-- **This was not enough, and the note that used to sit here said so wrongly.**
-- It claimed `grant_caddy_package` "already iterates `enum_range`", so no new
-- branch was needed. That trigger does iterate `enum_range` — over *quotas*,
-- inside a branch it only enters for a kind on a hardcoded list of the two
-- older rungs. So this rung sold and granted nothing until
-- `20260911000000` replaced that list with a question the tariff can answer.
-- Kept rather than reworded, because the mistake is the useful part: adding a
-- rung touches several places, and every one of them holding its own copy of
-- "which rungs exist" is one that can be missed.
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

-- ---------------------------------------------------------------------------
-- What the caddy did, kept — and a bug report that can point at it.
--
-- `caddy_turns` records what a turn *cost*: the model, the tokens, the money.
-- It has never recorded what the caddy **did** — which tools it reached for, in
-- what order, which pub it put on hole four, which ones it ruled out on the
-- way. So when a host says "this course is wrong" the only evidence is the card
-- at the end, and everything that produced it is gone.
--
-- That is the feedback loop these two columns close. A report filed from the
-- drafting table carries its session; the session's turns carry their traces;
-- and "why did it choose that" stops being a re-run and a guess.
--
-- ## Inputs, never replies — the rule that makes a trace safe to keep
--
-- A tool *call* is the caddy's decision. A tool *result* is mostly Google's
-- data: `searchResultBlock`, `boardBlock` and `routesBlock` are built out of
-- pub names, editorial lines and review snippets, which this app holds for the
-- length of one conversation and then sweeps (`lib/caddy/window.ts`). Copying
-- them into a permanent audit row would quietly undo that retention rule, and
-- would do it in the one table nobody thinks of as holding Google's data.
--
-- So a trace stores the inputs and the *size* of each reply. It loses almost
-- nothing worth having: every pub in it is a candidate id, candidate ids
-- resolve to `venues` rows, and `venues` is the shared Places cache this app
-- already keeps permanently. A trace read months later still names real pubs —
-- it reads them from the place they were always kept. The argument in full is
-- at the top of `lib/caddy/trace.ts`.
--
-- Bounded, because an audit nobody can afford is an audit nobody keeps. The
-- CHECK mirrors `TRACE_MAX_BYTES`; `trimTrace` is what keeps an insert from
-- meeting it, and an insert refused here would cost a host their card.
--
-- Additive per DEPLOYMENT.md: two nullable columns with no default. Code that
-- has never heard of either keeps writing turns and reports exactly as before.
-- ---------------------------------------------------------------------------

alter table public.caddy_turns
  add column if not exists trace jsonb
    check (
      trace is null
      or (jsonb_typeof(trace) = 'object' and char_length(trace::text) <= 16000)
    );

comment on column public.caddy_turns.trace is
  'What the caddy did: tool calls with their inputs and the size of each reply. '
  'Never the replies themselves — those carry Google Places content, which is '
  'swept with the dossier. Null on paths with no tools (a roll, a tweak).';

-- The host's own audit, and nobody else's. `caddy_turns` is already
-- select+insert for `authenticated` and scoped to its host by RLS, with no
-- update and no delete policy — append-only, which is exactly the shape an
-- audit record wants. The new column inherits all of it and needs no grant of
-- its own: a column added to a table is covered by that table's existing
-- column-less grants.

-- ---------------------------------------------------------------------------
-- A report that knows which conversation it is about.
--
-- `bug_reports` already carries a private `round_code` that never reaches the
-- public issue. This is the same shape for the same reason: the session id
-- stays on the row, the issue goes on carrying nothing but that row's own id,
-- and whoever triages it looks the report up and follows the link.
--
-- That is deliberately not "the session id is secret" — it is that the public
-- surface is already exactly one opaque id, and widening it by a second one
-- buys nothing a lookup does not.
--
-- `on delete set null`, never a cascade: a report outlives the session it is
-- about. The complaint is still a complaint once the conversation is gone, and
-- losing it would delete the evidence the reporter took the trouble to file.
-- ---------------------------------------------------------------------------

alter table public.bug_reports
  add column if not exists caddy_session_id uuid
    references public.caddy_sessions (id) on delete set null;

comment on column public.bug_reports.caddy_session_id is
  'The caddy conversation this report is about, when it was filed from the '
  'drafting table. Private to the reporter and to service_role;

never printed '
  'on the public issue.';

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
-- A report about a card names the card, not just the conversation.
--
-- `bug_reports.caddy_session_id` (20260910000000) says *which conversation*
-- went wrong. A conversation is up to sixty-five turns, and by the time
-- anybody triages the report the session holds every card the host ever
-- looked at — so "the caddy put a Wetherspoons on hole four" arrives attached
-- to a session whose last card may have been rolled twice since.
--
-- The feedback loop the session id was added for is: read the complaint, read
-- the trace behind the card it is about, fix the prompt or the router, ship.
-- Without the turn, the first step of that is guessing which card they meant,
-- and a guess in step one is a loop that quietly stops being run.
--
-- Nullable and additive: a report filed from the profile screen, or from a
-- drafting table that has not planned anything, carries neither id and always
-- will. `on delete set null` for the same reason the session link has it — a
-- report outlives the thing it is about, and the complaint is still a
-- complaint once the turn is swept.
--
-- Nothing about the public issue changes. The issue goes on carrying exactly
-- one opaque id — the report row's own — and whoever triages follows the link
-- into the private row. That was never "the session id is secret"; it is that
-- the public surface is already one id, and widening it by a second buys
-- nothing a lookup does not.
--
-- No grant: `bug_reports` carries table-level `select, insert` to
-- `authenticated`, which covers a column added later. The narrow column grants
-- elsewhere in this schema are deliberately narrow UPDATE grants doing real
-- work, and a redundant one here would make them look like the pattern rather
-- than the exception.
-- ---------------------------------------------------------------------------

alter table public.bug_reports
  add column if not exists caddy_turn_id uuid
    references public.caddy_turns (id) on delete set null;

comment on column public.bug_reports.caddy_turn_id is
  'The exact card this report is about — one turn of the conversation named '
  'by caddy_session_id. Private to the reporter and to service_role;

never '
  'printed on the public issue.';

-- ---------------------------------------------------------------------------
-- And it may only name a turn the reporter actually took.
--
-- The same shape as `owns_caddy_session` in `20260912000000`, and needed for
-- the same reason that one was: a foreign key check runs with row security
-- OFF, so the reference proves the turn exists and proves nothing about whose
-- it is. Without this a reporter could point a report at any turn id in the
-- table — which leaks nothing through the public issue, and still puts another
-- host's card in the middle of an audit trail that exists to be trusted.
--
-- Belt and braces with the session guard rather than instead of it: the two
-- ids can disagree (a turn from a different conversation), and the cheapest
-- honest answer to that is to check the turn on its own terms — its `host`,
-- which `caddy_turns` denormalises for exactly this sort of question.
-- ---------------------------------------------------------------------------

create or replace function public.owns_caddy_turn(turn uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select turn is null
      or exists (
        select 1 from public.caddy_turns t
         where t.id = turn and t.host = auth.uid()
      );
$$;

revoke execute on function public.owns_caddy_turn(uuid) from public, anon;

grant execute on function public.owns_caddy_turn(uuid) to authenticated, service_role;

create policy "bug reports: file your own" on public.bug_reports
  for insert to authenticated
  with check (
    reporter = (select auth.uid())
    and public.owns_caddy_session(caddy_session_id)
    and public.owns_caddy_turn(caddy_turn_id)
  );

-- ---------------------------------------------------------------------------
-- The retention promise, actually kept.
--
-- The privacy notice says Google's descriptions, ratings and review snippets
-- are "held only for as long as you are working on that course — about half a
-- day — and are then deleted". Two things enforced that, and neither of them
-- deleted anything:
--
--   `patchIsOpen` refuses to *use* a dossier past the window, and
--   `closeCaddySession` clears one when a course is filed.
--
-- So a host who planned a card and closed the tab left Google's data in
-- `caddy_sessions.dossier` for ever. The sentence was true about what the app
-- would *read* and false about what the database *held*, which is the half
-- that matters — the promise is about storage.
--
-- `RESUMABLE_HOURS` in `lib/caddy/window.ts` is 12 and this is 12, and the
-- comment there explains why the clock runs from `created_at` rather than the
-- last turn: a conversation does not renew itself by being talked to, or a
-- session poked once an hour would hold Google's data indefinitely.
--
-- **The card is not swept.** `caddy_turns.result` is the course the host
-- bought, hung on `venues` rows, and it stays as long as their account does.
-- What goes is the atmosphere data the model read to choose — which is the
-- part Google's terms bound and the part nobody needs once the card exists.
-- Reopening a patch fetches it again (`reopenCaddyPatch`), which is exactly
-- what the notice describes.
-- ---------------------------------------------------------------------------

create or replace function public.sweep_caddy_dossiers()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  swept integer;
begin
  -- Empty rather than deleted: the session row is the audit trail, and the
  -- host may still hold credits against it. `patchIsOpen` already reads an
  -- empty dossier as "that patch has been put away", so nothing downstream
  -- learns a new state.
  update public.caddy_sessions
     set dossier = '[]'::jsonb
   where dossier <> '[]'::jsonb
     and created_at < pg_catalog.now() - interval '12 hours';
  get diagnostics swept = row_count;
  return swept;
end;
$$;

comment on function public.sweep_caddy_dossiers() is
  'Empties Google Places atmosphere data out of caddy sessions past the '
  '12-hour conversation window. The card the host bought is untouched.';

-- Nobody's to call but the scheduler's. A host cannot usefully run it — their
-- own stale dossier is already unreadable to the app — and it writes across
-- every row in the table, which is not a thing an ordinary session should be
-- able to set off.
revoke execute on function public.sweep_caddy_dossiers() from public, anon, authenticated;

grant execute on function public.sweep_caddy_dossiers() to service_role;

-- ---------------------------------------------------------------------------
-- Scheduled hourly, where there is a scheduler.
--
-- Guarded rather than assumed. `pg_cron` is available on the hosted projects
-- and is *not* installed by default, and a migration that hard-required it
-- would fail on any stack that ships without it — which would take the whole
-- db test tier down with it, since every one of those runs starts from
-- `supabase db reset`. The function above is the load-bearing part and applies
-- everywhere; the schedule is a convenience on top of it.
--
-- Hourly rather than nightly because the window is half a day: a nightly
-- sweep means the oldest row waits up to 24 hours past its 12, which is the
-- notice's "about half a day" stretched to a day and a half.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- Idempotent: unschedule first, so re-running this migration on a project
    -- that already has the job does not raise a duplicate.
    perform cron.unschedule('sweep-caddy-dossiers')
      where exists (select 1 from cron.job where jobname = 'sweep-caddy-dossiers');
    perform cron.schedule(
      'sweep-caddy-dossiers',
      '17 * * * *',
      'select public.sweep_caddy_dossiers()'
    );
  else
    raise notice 'pg_cron not available; sweep_caddy_dossiers() is installed but unscheduled';
  end if;
exception when insufficient_privilege then
  -- A stack where the migration role cannot create extensions. The function is
  -- still there and can be scheduled by hand; failing the migration over a
  -- convenience would be the worse trade.
  raise notice 'cannot schedule sweep_caddy_dossiers(): %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- The two lookups every tee-off performs, indexed — and one index that has
-- never had a row, dropped.
--
-- **`entitlements (user_id, kind)`.** This is the predicate behind
-- `holds_day_pass`, `getDayPass`, `liveFee`'s fallback and the second-fee
-- guard: four different questions, all of them "what has this person bought",
-- and none of them able to do better than a sequential scan. `holds_day_pass`
-- alone is called by `guard_round_members` on the tee-off path, by every caddy
-- turn, and by the drafting table on load. `entitlements` is small today and
-- will be the largest table this app has if any of it works, and a scan that
-- is invisible at a hundred rows is the one that surprises somebody at a
-- hundred thousand.
--
-- Partial on `expires_at`, because every caller asks the same follow-up
-- question — is it still running, or dormant — and a null expiry is the
-- ordinary case since the day moved to tee-off.
--
-- **`caddy_spends (host)`.** Its RLS policy filters on `host` and
-- `guard_caddy_course_slot` counts spends by host on every course a caddy
-- files. `caddy_spends_grant_idx` covers the join and nothing covered the
-- filter.
--
-- **`entitlements_one_per_round` stays**, and it is worth saying why, because
-- an earlier pass dropped it. Nothing has written a non-null `round_id` since
-- the green fee became a day pass on its buyer (`20260823000000`) — the
-- webhook writes null, deliberately — so on the face of it the index is a
-- partial predicate nothing can satisfy. But `tests/db/rls-entitlements.test.ts`
-- exercises it directly with two per-round rows and asserts the `23505`, which
-- makes it a rule somebody wrote down rather than a leftover. A constraint
-- costs nothing to keep and the column is a plausible future; removing one
-- that has a test is a behaviour change nobody asked for.
--
-- Additive per DEPLOYMENT.md in both directions — an index is invisible to
-- code, and the dropped one constrains no write any deployed build makes.
-- ---------------------------------------------------------------------------

create index if not exists entitlements_holder_idx
  on public.entitlements (user_id, kind, expires_at);

create index if not exists caddy_spends_host_idx
  on public.caddy_spends (host);

