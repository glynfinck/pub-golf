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
