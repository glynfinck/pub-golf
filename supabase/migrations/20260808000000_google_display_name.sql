-- Sign-in is Google-only now. The old email flow passed `display_name` in the
-- signup metadata itself, so the trigger only ever had to read that one key;
-- Google's OIDC claims arrive as `full_name` / `name` instead, which would
-- have landed every host on the 'Player' fallback.
--
-- Anonymous guests still have no metadata and no email, so they keep the
-- fallback and get their real name from join_round. Linking Google to an
-- anonymous card does not re-run this trigger (it fires on insert only), so a
-- guest who claims their card keeps the name they played under.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Player'
    )
  );
  return new;
end;
$$;
