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
-- is what prices the tariff (docs/CADDY-TOPUPS.md). Evidence, not a gate.
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
