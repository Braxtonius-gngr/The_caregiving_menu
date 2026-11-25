-- "This was wrong?" on AI results and "Something's wrong?" in help (design: step-c2-reports.md).
-- Owners read their family's reports, the sender reads their own, the app maker reads all and
-- is the only one who changes status or replies. Reports live in the family (erased with it).

create table if not exists app_admins (user_id uuid primary key);
alter table app_admins enable row level security;
-- The app maker's account is added by hand (insert into app_admins values ('<user id>')), not kept in this public repo.

create or replace function is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid())
$$;
grant execute on function is_app_admin() to authenticated;

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  who text,
  kind text not null check (kind in ('ai', 'app')),
  feature text,
  choices text[] not null default '{}',
  comment text,
  ai_input jsonb,
  ai_output jsonb,
  photo_paths text[] not null default '{}',
  app_version text,
  device text,
  status text not null default 'new' check (status in ('new', 'seen', 'fixed')),
  reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reports_household on reports (household_id, created_at desc);
create index if not exists reports_status on reports (status, created_at desc);
alter table reports enable row level security;
drop policy if exists reports_read on reports;
create policy reports_read on reports for select using (
  household_id in (select my_owned_household_ids()) or user_id = auth.uid() or is_app_admin());
drop policy if exists reports_add on reports;
create policy reports_add on reports for insert with check (
  household_id in (select my_household_ids()) and user_id = auth.uid() and status = 'new' and reply is null);
drop policy if exists reports_admin on reports;
create policy reports_admin on reports for update using (is_app_admin()) with check (is_app_admin());

-- Any member (viewers too) may add a report photo under <family>/reports/; the app maker can read them.
drop policy if exists photos_report_insert on storage.objects;
create policy photos_report_insert on storage.objects for insert with check (
  bucket_id = 'photos' and (storage.foldername(name))[2] = 'reports'
  and (storage.foldername(name))[1] in (select my_household_ids()::text));
drop policy if exists photos_admin_read on storage.objects;
create policy photos_admin_read on storage.objects for select using (
  bucket_id = 'photos' and (storage.foldername(name))[2] = 'reports' and is_app_admin());

-- Leaving as "Former member" also clears the sender on their reports.
create or replace function redact_member(hid uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare z uuid := '00000000-0000-0000-0000-000000000000'; t text;
begin
  set local session_replication_role = replica; -- no edit-history rows or author stamps for this
  foreach t in array array['records', 'diary_entries', 'measurements', 'entry_photos'] loop
    execute format('update %I set user_id = case when user_id = $2 then $3 else user_id end, edited_by = case when edited_by = $2 then $3 else edited_by end, updated_at = now() where household_id = $1 and (user_id = $2 or edited_by = $2)', t) using hid, uid, z;
  end loop;
  update consents set user_id = z where household_id = hid and user_id = uid;
  update ai_usage set user_id = z where household_id = hid and user_id = uid;
  update household_invites set created_by = z where household_id = hid and created_by = uid;
  update data_requests set user_id = z, who = null where household_id = hid and user_id = uid;
  update reports set user_id = z, who = null where household_id = hid and user_id = uid;
  update audit_log set changed_by = case when changed_by = uid then z else changed_by end,
    old_row = case when old_row is null then null else old_row
      || case when old_row->>'user_id' = uid::text then jsonb_build_object('user_id', z) else '{}' end
      || case when old_row->>'edited_by' = uid::text then jsonb_build_object('edited_by', z) else '{}' end end,
    new_row = case when new_row is null then null else new_row
      || case when new_row->>'user_id' = uid::text then jsonb_build_object('user_id', z) else '{}' end
      || case when new_row->>'edited_by' = uid::text then jsonb_build_object('edited_by', z) else '{}' end end
  where household_id = hid and (changed_by = uid or old_row->>'user_id' = uid::text or old_row->>'edited_by' = uid::text
    or new_row->>'user_id' = uid::text or new_row->>'edited_by' = uid::text);
  set local session_replication_role = origin; -- or later deletes in the same transaction skip their cascades
end $$;
revoke execute on function redact_member(uuid, uuid) from public, anon, authenticated;
