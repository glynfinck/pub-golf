-- ---------------------------------------------------------------------------
-- Entitlements: what a payment bought, and nothing else.
--
-- One row per purchase, written by exactly one author: the Stripe webhook,
-- driving PostgREST as service_role. The app never writes here — there are
-- deliberately no insert/update/delete policies, so the authenticated role
-- cannot forge a purchase, retract one, or move one between rounds. Reading
-- follows the round: premium features render for the whole table, so every
-- member of a round may see that its green fee is paid; a user-scoped row
-- (round_id null — a future season ticket) is visible to its owner alone.
--
-- Idempotency is schema-level, where retries cannot outrun it (Stripe
-- redelivers until it hears 200, and this codebase already learned that
-- read-then-check loses races — 20260816): stripe_event_id is unique, so a
-- redelivered event inserts nothing, and one green fee per round is a
-- partial unique index rather than an application check.
--
-- Additive on purpose: deployed code reads nothing from this table until
-- the UI that sells something ships, so the migration can land ahead of the
-- code (DEPLOYMENT.md — the two integrations do not wait for each other).
-- ---------------------------------------------------------------------------

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  round_id uuid references public.rounds (id) on delete cascade,
  kind text not null check (kind in ('green_fee', 'season_ticket')),
  -- The webhook event that wrote the row; unique is the retry guard.
  stripe_event_id text not null unique,
  stripe_session_id text,
  created_at timestamptz not null default now()
);

-- One green fee per round, however many checkouts race for it.
create unique index entitlements_one_per_round
  on public.entitlements (round_id, kind)
  where round_id is not null;

alter table public.entitlements enable row level security;

create policy "entitlements: members read the round's, owners their own"
  on public.entitlements for select to authenticated
  using (
    user_id = (select auth.uid())
    or (round_id is not null and public.is_round_member(round_id))
  );

-- The Data API gate init.sql warned about: new tables are not auto-exposed.
-- anon gets the grant but no policy, so a visitor reads zero rows rather
-- than a 42501; service_role rides 20260811's default privileges.
grant select on public.entitlements to anon, authenticated;
