-- The pub on a hole can change hands mid-round: the shutters come down, the
-- kitchen stops serving, the place turns out to be a members' club. Officials
-- point the hole at somewhere else and the round carries on — same number,
-- same par, same drink, same standings, because scores and penalties key on
-- the hole *number* and never on the venue.
--
-- No new policy: "officials manage holes" (init) is already `for all`, so the
-- host and the caddy could always write these rows. What changes is that
-- `holes` stops being a table nothing ever touches after the round is built,
-- and the other phones have to hear about it — until now the card was
-- immutable, so it was never published.
--
-- Additive on purpose, for the deploy race the two integrations create: a
-- build that has not shipped the subscriber yet simply does not listen, and
-- one that has still falls back to its own ten-second poll. Realtime keeps
-- filtering every event through "members read holes" per subscriber, so this
-- widens what members are told, never who is told.
do $$
begin
  alter publication supabase_realtime add table public.holes;
exception
  -- Already published (a re-run, or a project where it was added by hand).
  when duplicate_object then null;
end $$;
