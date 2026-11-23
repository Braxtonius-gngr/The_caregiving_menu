-- Patient file: one records table for every section (conditions, allergies, medicines,
-- directives, care team contacts, labs, visits, documents, family updates). Each kind keeps
-- its details in `fields`. Same sync columns, roles, author stamp and edit history as the
-- diary, so History, Restore and Deleted work here too.
-- Files attached to a record (photos or PDFs) are rows in entry_photos with
-- entry_store = 'records'; `mime` says which.

create table if not exists records (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  for_profile_id uuid,
  kind text not null check (kind in ('condition', 'allergy', 'medication', 'directive', 'contact', 'lab', 'visit', 'document', 'update')),
  title text not null default '', occurred_at timestamptz, fields jsonb not null default '{}',
  user_id uuid default auth.uid(), edited_by uuid,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);
create index if not exists records_sync on records (household_id, updated_at);
alter table records enable row level security;
drop policy if exists records_read on records;
drop policy if exists records_insert on records;
drop policy if exists records_update on records;
drop policy if exists records_delete on records;
create policy records_read on records for select using (household_id in (select my_household_ids()));
create policy records_insert on records for insert with check (household_id in (select my_writable_household_ids()));
create policy records_update on records for update using (household_id in (select my_writable_household_ids())) with check (household_id in (select my_writable_household_ids()));
create policy records_delete on records for delete using (household_id in (select my_owned_household_ids()));
drop trigger if exists records_touch on records;
create trigger records_touch before insert or update on records for each row execute function touch_updated_at();
drop trigger if exists records_author on records;
create trigger records_author before insert or update on records for each row execute function stamp_author();
drop trigger if exists records_audit on records;
create trigger records_audit after insert or update on records for each row execute function audit_row();

alter table entry_photos add column if not exists mime text not null default 'image/jpeg';
alter table entry_photos add column if not exists file_name text;
