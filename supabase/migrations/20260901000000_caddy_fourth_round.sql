-- ---------------------------------------------------------------------------
-- A fee buys four courses, not three.
--
-- The fee moved to £12 when the caddy shipped, and four is what makes it read
-- as a discount rather than merely a bundle: £3 a round inside the fee, where
-- the smallest top-up will be £4. The bundle has to be the best rate anyone
-- can get, or it is the mug's option — buy the cheapest fee, top up in bulk,
-- and the thing meant to be the deal is the thing to avoid.
--
-- Tweaks are untouched at 60. They are ~2p each against ~27p for a re-design,
-- so they are not what the price is carrying, and the number is set where a
-- real evening never reaches it anyway.
--
-- `20260831000000` has already run, so this cannot be an edit to it. Additive
-- per DEPLOYMENT.md: `create or replace` on a function every caller already
-- knows, plus one bounded UPDATE. Code that has not deployed yet reads four
-- and is right; code still running reads whatever it asks for and is also
-- right, because this changes an amount, not a shape.
-- ---------------------------------------------------------------------------

create or replace function public.caddy_grant_size(quota public.caddy_quota)
returns integer language sql immutable as $$
  select case quota when 'redesign' then 4 when 'tweak' then 60 end
$$;

-- Grants already minted keep the amount they were minted with — a grant is a
-- record of what was given, not a live lookup, and rewriting history is how a
-- ledger stops being one.
--
-- But a host holding a live fee bought ten minutes ago should not be short a
-- course because of when they happened to pay. So live re-design grants at the
-- old size are topped up to the new one: bounded to unexpired rows, matched on
-- the exact old amount so it cannot double-apply, and untouchable once the day
-- has run out. Spends against these rows are unaffected — the balance is
-- grants minus spends, so a grant going from 3 to 4 gives back exactly one
-- course to somebody who has already used two.
update public.caddy_grants
   set amount = 4
 where quota = 'redesign'
   and amount = 3
   and (expires_at is null or expires_at > now());
