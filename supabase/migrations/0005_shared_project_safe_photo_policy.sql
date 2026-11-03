-- Make the photo policy safe in a project shared with other apps.
-- Postgres doesn't promise to check bucket_id first, so casting every object's
-- first folder to uuid could fail on another app's files. Compare as text instead.
drop policy if exists photos_household on storage.objects;
create policy photos_household on storage.objects for all
  using (bucket_id = 'photos' and (storage.foldername(name))[1] in (select my_household_ids()::text))
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] in (select my_household_ids()::text));
