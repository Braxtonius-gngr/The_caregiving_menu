-- Diary photos now live in the private `photos` Storage bucket (photo_path).
-- The base64 copy is kept on each device only and is never pushed, so the
-- column is unused. Dropping it keeps rows small.
--
-- Safety: a project that ever synced photos into this column keeps it (and the
-- photos) instead of losing them; the app ignores the column either way.
do $$
begin
  if not exists (select 1 from diary_entries where photo_data is not null) then
    alter table diary_entries drop column if exists photo_data;
  else
    raise notice 'diary_entries.photo_data still holds photos; column kept';
  end if;
end $$;
