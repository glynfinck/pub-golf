-- ---------------------------------------------------------------------------
-- What a link preview may say about a round.
--
-- An Open Graph crawler has no session — it is not a member, not the host, not
-- even signed in — so the card an unfurled link shows cannot come from the
-- round tables directly. get_round_preview already answers the anon question
-- "may I join this?", but it filters `status in ('lobby','live')` on purpose:
-- a finished round is not joinable and /join should keep saying so. Widening
-- it would make the join screen promise something join_round then refuses.
--
-- So this is its sibling, answering a different question — "what does this
-- round look like on a card?" — for a round in any state.
--
-- Deliberately no player names, no scores, no host: the round routes redirect
-- a signed-out visitor, and a preview must not become a way to read a card you
-- cannot open. Name, size and par only, which is what the sharer is already
-- putting in the group chat themselves.
-- ---------------------------------------------------------------------------
create function public.get_round_card(join_code text)
returns table (
  name text,
  status text,
  hole_count bigint,
  par bigint,
  created_at timestamptz
)
language sql
security definer set search_path = ''
stable
as $$
  select
    r.name,
    r.status,
    (select count(*) from public.holes h where h.round_id = r.id),
    (select coalesce(sum(h.par), 0) from public.holes h where h.round_id = r.id),
    r.created_at
  from public.rounds r
  where r.code = upper(join_code);
$$;

grant execute on function public.get_round_card (text) to anon, authenticated;
