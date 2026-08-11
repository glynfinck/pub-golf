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

-- What one green fee buys of caddy, in micropence: twelve per cent of the £4
-- sticker. Mirrored by caddyBudgetMicroPence() in lib/caddy/budget.ts, which
-- derives it from TARIFF so the two move together — **this number must be
-- changed in the same commit as the tariff**, and a db test is what catches it
-- if it is not.
create function public.caddy_budget_micropence()
returns bigint
language sql
immutable
as $$ select 48000000::bigint $$;

-- ---------------------------------------------------------------------------
-- The guard, now counting two things.
--
-- Replacing the function rather than the trigger keeps the binding 20260825
-- made, and keeps the advisory lock exactly where it was — keyed on the host,
-- not `for update` on their profile row, because FOR UPDATE conflicts with the
-- FOR KEY SHARE lock every foreign key onto profiles takes and would put the
-- caddy in the way of somebody joining a round. The lock is what makes both
-- counts safe against concurrent writers: 20260816 is the scar that proves a
-- read-then-check allowance loses that race.
-- ---------------------------------------------------------------------------
create or replace function public.guard_caddy_fair_use()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  turns integer;
  cap integer := public.caddy_fair_use_cap();
  spent bigint;
  budget bigint := public.caddy_budget_micropence();
begin
  -- The cost is ours to compute, not the caller's to declare. Done before the
  -- service_role exemption so a seeded row still carries a truthful bill.
  new.cost_micropence := public.caddy_cost_micropence(
    new.model,
    new.input_tokens,
    new.output_tokens,
    new.cache_write_tokens,
    new.cache_read_tokens
  );

  -- service_role is the seeder and the tests, not the attacker this guards
  -- against — the same exemption every other guard on this stack carries.
  if coalesce(auth.jwt() ->> 'role', current_user) is distinct from 'authenticated' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.host::text, 0)
  );

  -- Two counts over two different sets, which is the whole point of `failed`:
  -- a card consumes a turn, every call consumes money.
  select count(*) filter (where not t.failed), coalesce(sum(t.cost_micropence), 0)
    into turns, spent
    from public.caddy_turns t
   where t.host = new.host
     and t.created_at > pg_catalog.now() - interval '24 hours';

  if turns >= cap then
    raise exception 'The caddy has done a full shift on this fee (% turns in 24 hours)', cap
      using errcode = '42501';
  end if;

  -- Checked before the spend, not after: the cost of the call about to be made
  -- is already known (it just happened), but the *next* one is not, so this is
  -- a "have you had enough" test. The overshoot is bounded by max_tokens and by
  -- the conversation cap the app applies inside its own tool loop.
  if spent >= budget then
    raise exception 'The caddy has done a full shift on this fee (budget %)', budget
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- The rolling-window sum runs on the index 20260825 already created for the
-- count (host, created_at desc) — same predicate, one more column read.

grant execute on function public.caddy_budget_micropence ()
  to anon, authenticated, service_role;
grant execute on function public.caddy_cost_micropence (text, integer, integer, integer, integer)
  to anon, authenticated, service_role;
