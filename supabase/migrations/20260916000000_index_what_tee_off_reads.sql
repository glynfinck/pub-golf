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
-- **`entitlements_one_per_round`** goes. It is a unique index on
-- `(round_id, kind) where round_id is not null`, and since the green fee
-- became a day pass on its buyer (`20260823000000`) nothing has ever written a
-- non-null `round_id` — the webhook writes null, deliberately, and
-- `20260823000000` already carries a note explaining that the index no longer
-- describes anything. An index whose partial predicate can never be satisfied
-- is a rule a reader will spend time understanding and a writer will never
-- meet. The column stays: a per-round purchase is a plausible future and the
-- FK is honest about it.
--
-- Additive per DEPLOYMENT.md in both directions — an index is invisible to
-- code, and the dropped one constrains no write any deployed build makes.
-- ---------------------------------------------------------------------------

create index if not exists entitlements_holder_idx
  on public.entitlements (user_id, kind, expires_at);

create index if not exists caddy_spends_host_idx
  on public.caddy_spends (host);

drop index if exists public.entitlements_one_per_round;
