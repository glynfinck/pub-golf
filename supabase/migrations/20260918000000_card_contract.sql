-- The Card Contract's ledger line.
--
-- lib/caddy/contract.ts checks every card that lands against the clauses a
-- card worth paying for satisfies, and this is where the findings go: one
-- jsonb record on the turn that produced the card. Nullable, because a turn
-- written by the deployed code of a minute ago carries no score and that is
-- fine — the clean-card rate is computed over turns that have one.
--
-- Additive on purpose, per DEPLOYMENT.md: the currently-deployed code never
-- reads this column, and the new code retries its insert without it if the
-- migration has not landed yet.

alter table public.caddy_turns
  add column if not exists contract jsonb
    check (
      contract is null
      or (jsonb_typeof(contract) = 'object' and char_length(contract::text) <= 20000)
    );

comment on column public.caddy_turns.contract is
  'Card Contract findings for the card this turn filed ({clean, findings}); null before the validator shipped.';
