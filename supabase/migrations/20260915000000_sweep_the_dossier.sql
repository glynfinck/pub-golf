-- ---------------------------------------------------------------------------
-- The retention promise, actually kept.
--
-- The privacy notice says Google's descriptions, ratings and review snippets
-- are "held only for as long as you are working on that course — about half a
-- day — and are then deleted". Two things enforced that, and neither of them
-- deleted anything:
--
--   `patchIsOpen` refuses to *use* a dossier past the window, and
--   `closeCaddySession` clears one when a course is filed.
--
-- So a host who planned a card and closed the tab left Google's data in
-- `caddy_sessions.dossier` for ever. The sentence was true about what the app
-- would *read* and false about what the database *held*, which is the half
-- that matters — the promise is about storage.
--
-- `RESUMABLE_HOURS` in `lib/caddy/window.ts` is 12 and this is 12, and the
-- comment there explains why the clock runs from `created_at` rather than the
-- last turn: a conversation does not renew itself by being talked to, or a
-- session poked once an hour would hold Google's data indefinitely.
--
-- **The card is not swept.** `caddy_turns.result` is the course the host
-- bought, hung on `venues` rows, and it stays as long as their account does.
-- What goes is the atmosphere data the model read to choose — which is the
-- part Google's terms bound and the part nobody needs once the card exists.
-- Reopening a patch fetches it again (`reopenCaddyPatch`), which is exactly
-- what the notice describes.
-- ---------------------------------------------------------------------------

create or replace function public.sweep_caddy_dossiers()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  swept integer;
begin
  -- Empty rather than deleted: the session row is the audit trail, and the
  -- host may still hold credits against it. `patchIsOpen` already reads an
  -- empty dossier as "that patch has been put away", so nothing downstream
  -- learns a new state.
  update public.caddy_sessions
     set dossier = '[]'::jsonb
   where dossier <> '[]'::jsonb
     and created_at < pg_catalog.now() - interval '12 hours';
  get diagnostics swept = row_count;
  return swept;
end;
$$;

comment on function public.sweep_caddy_dossiers() is
  'Empties Google Places atmosphere data out of caddy sessions past the '
  '12-hour conversation window. The card the host bought is untouched.';

-- Nobody's to call but the scheduler's. A host cannot usefully run it — their
-- own stale dossier is already unreadable to the app — and it writes across
-- every row in the table, which is not a thing an ordinary session should be
-- able to set off.
revoke execute on function public.sweep_caddy_dossiers() from public, anon, authenticated;
grant execute on function public.sweep_caddy_dossiers() to service_role;

-- ---------------------------------------------------------------------------
-- Scheduled hourly, where there is a scheduler.
--
-- Guarded rather than assumed. `pg_cron` is available on the hosted projects
-- and is *not* installed by default, and a migration that hard-required it
-- would fail on any stack that ships without it — which would take the whole
-- db test tier down with it, since every one of those runs starts from
-- `supabase db reset`. The function above is the load-bearing part and applies
-- everywhere; the schedule is a convenience on top of it.
--
-- Hourly rather than nightly because the window is half a day: a nightly
-- sweep means the oldest row waits up to 24 hours past its 12, which is the
-- notice's "about half a day" stretched to a day and a half.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- Idempotent: unschedule first, so re-running this migration on a project
    -- that already has the job does not raise a duplicate.
    perform cron.unschedule('sweep-caddy-dossiers')
      where exists (select 1 from cron.job where jobname = 'sweep-caddy-dossiers');
    perform cron.schedule(
      'sweep-caddy-dossiers',
      '17 * * * *',
      'select public.sweep_caddy_dossiers()'
    );
  else
    raise notice 'pg_cron not available; sweep_caddy_dossiers() is installed but unscheduled';
  end if;
exception when insufficient_privilege then
  -- A stack where the migration role cannot create extensions. The function is
  -- still there and can be scheduled by hand; failing the migration over a
  -- convenience would be the worse trade.
  raise notice 'cannot schedule sweep_caddy_dossiers(): %', sqlerrm;
end $$;
