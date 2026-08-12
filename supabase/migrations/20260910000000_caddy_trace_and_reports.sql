-- ---------------------------------------------------------------------------
-- What the caddy did, kept — and a bug report that can point at it.
--
-- `caddy_turns` records what a turn *cost*: the model, the tokens, the money.
-- It has never recorded what the caddy **did** — which tools it reached for, in
-- what order, which pub it put on hole four, which ones it ruled out on the
-- way. So when a host says "this course is wrong" the only evidence is the card
-- at the end, and everything that produced it is gone.
--
-- That is the feedback loop these two columns close. A report filed from the
-- drafting table carries its session; the session's turns carry their traces;
-- and "why did it choose that" stops being a re-run and a guess.
--
-- ## Inputs, never replies — the rule that makes a trace safe to keep
--
-- A tool *call* is the caddy's decision. A tool *result* is mostly Google's
-- data: `searchResultBlock`, `boardBlock` and `routesBlock` are built out of
-- pub names, editorial lines and review snippets, which this app holds for the
-- length of one conversation and then sweeps (`lib/caddy/window.ts`). Copying
-- them into a permanent audit row would quietly undo that retention rule, and
-- would do it in the one table nobody thinks of as holding Google's data.
--
-- So a trace stores the inputs and the *size* of each reply. It loses almost
-- nothing worth having: every pub in it is a candidate id, candidate ids
-- resolve to `venues` rows, and `venues` is the shared Places cache this app
-- already keeps permanently. A trace read months later still names real pubs —
-- it reads them from the place they were always kept. The argument in full is
-- at the top of `lib/caddy/trace.ts`.
--
-- Bounded, because an audit nobody can afford is an audit nobody keeps. The
-- CHECK mirrors `TRACE_MAX_BYTES`; `trimTrace` is what keeps an insert from
-- meeting it, and an insert refused here would cost a host their card.
--
-- Additive per DEPLOYMENT.md: two nullable columns with no default. Code that
-- has never heard of either keeps writing turns and reports exactly as before.
-- ---------------------------------------------------------------------------

alter table public.caddy_turns
  add column if not exists trace jsonb
    check (
      trace is null
      or (jsonb_typeof(trace) = 'object' and char_length(trace::text) <= 16000)
    );

comment on column public.caddy_turns.trace is
  'What the caddy did: tool calls with their inputs and the size of each reply. '
  'Never the replies themselves — those carry Google Places content, which is '
  'swept with the dossier. Null on paths with no tools (a roll, a tweak).';

-- The host's own audit, and nobody else's. `caddy_turns` is already
-- select+insert for `authenticated` and scoped to its host by RLS, with no
-- update and no delete policy — append-only, which is exactly the shape an
-- audit record wants. The new column inherits all of it and needs no grant of
-- its own: a column added to a table is covered by that table's existing
-- column-less grants.

-- ---------------------------------------------------------------------------
-- A report that knows which conversation it is about.
--
-- `bug_reports` already carries a private `round_code` that never reaches the
-- public issue. This is the same shape for the same reason: the session id
-- stays on the row, the issue goes on carrying nothing but that row's own id,
-- and whoever triages it looks the report up and follows the link.
--
-- That is deliberately not "the session id is secret" — it is that the public
-- surface is already exactly one opaque id, and widening it by a second one
-- buys nothing a lookup does not.
--
-- `on delete set null`, never a cascade: a report outlives the session it is
-- about. The complaint is still a complaint once the conversation is gone, and
-- losing it would delete the evidence the reporter took the trouble to file.
-- ---------------------------------------------------------------------------

alter table public.bug_reports
  add column if not exists caddy_session_id uuid
    references public.caddy_sessions (id) on delete set null;

comment on column public.bug_reports.caddy_session_id is
  'The caddy conversation this report is about, when it was filed from the '
  'drafting table. Private to the reporter and to service_role; never printed '
  'on the public issue.';

-- No grant needed for either column, and it is worth saying why rather than
-- leaving the absence to look like an oversight. Both tables carry *table*-level
-- grants (`grant select, insert on ... to authenticated`), and a table-level
-- grant covers columns added later. The column-level grants elsewhere in this
-- schema — `bug_reports (issue_number, issue_url)`, `caddy_sessions
-- (completed_at, dossier, course_id)` — are deliberately narrow UPDATE grants
-- doing real work, and adding a redundant one here would make them look like
-- the pattern rather than the exception.
