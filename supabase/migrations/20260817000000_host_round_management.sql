-- The host's locker: rounds gain their one missing lifecycle action.
--
-- Deleting a round was impossible by design — no DELETE policy existed on
-- rounds, and tests/db/rls-rounds.test.ts asserted as much so that adding
-- one would be a decision rather than a slip. This is that decision, made
-- for the manage sheet's "tear up the card": the host, and only the host,
-- can delete their own round. Not the caddy — officiating powers run the
-- round, they do not own it, and the update policy already draws that
-- line for the round's identity.
--
-- Every child table has declared `on delete cascade` since init — holes,
-- round_players, scores and penalties each reference rounds directly — so
-- the round takes the whole card with it in one statement.
--
-- Additive and deploy-safe: currently-deployed code never issues a DELETE
-- on rounds, so nothing changes for it while this applies.

create policy "hosts delete rounds"
  on public.rounds
  for delete to authenticated
  using (host = (select auth.uid()));
