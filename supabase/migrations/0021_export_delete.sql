-- Export, delete and leave (design: docs/private/product/design/step-c1-export-delete.md).
--
-- Deleting a family: an owner asks, the family is locked at once (read and export only),
-- any owner can cancel for 7 days, then the `account` function's purge erases it.
-- Leaving: the leaver chooses to keep their name on what they wrote (kept in former_members)
-- or to be shown as a former member (their id is replaced everywhere, so nobody can undo it).

alter table households add column if not exists erase_after timestamptz;
alter table households add column if not exists erase_requested_by uuid;
grant select (erase_after) on households to authenticated;

-- Every export, delete request, cancel and leave. Owners read the family's list; members
-- read their own rows. Only the server writes.
create table if not exists data_requests (
  id bigint generated always as identity primary key,
  household_id uuid references households(id) on delete cascade,
  user_id uuid,
  who text,
  kind text not null check (kind in ('export_family', 'export_mine', 'delete_family', 'cancel_delete', 'leave', 'delete_me')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists data_requests_household on data_requests (household_id, created_at desc);
alter table data_requests enable row level security;
drop policy if exists data_requests_read on data_requests;
create policy data_requests_read on data_requests for select
  using (household_id in (select my_owned_household_ids()) or user_id = auth.uid());

-- People who left and agreed to keep their name on what they wrote.
create table if not exists former_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null,
  display_name text not null,
  left_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
alter table former_members enable row level security;
drop policy if exists former_members_read on former_members;
create policy former_members_read on former_members for select using (household_id in (select my_household_ids()));

-- Proof that a family was erased; no health data.
create table if not exists erasures (
  household_id uuid primary key,
  requested_by uuid,
  requested_at timestamptz,
  erased_at timestamptz not null default now(),
  photos_removed int,
  accounts_removed int
);
alter table erasures enable row level security;

-- A family waiting to be erased is read-only for everyone.
create or replace function my_writable_household_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.household_id from members m join households h on h.id = m.household_id
  where m.user_id = auth.uid() and m.role in ('owner', 'caregiver') and h.erase_after is null
$$;

-- Replaces a member's id with the zero id in everything the family keeps, including the
-- edit history, so the name can't be recovered. Server only.
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

-- Erases a family's rows (photos and sign-ins are removed by the account function first).
create or replace function erase_household_rows(hid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from audit_log where household_id = hid;
  delete from households where id = hid; -- every other table cascades
end $$;
revoke execute on function erase_household_rows(uuid) from public, anon, authenticated;

-- Every photo path of a family: for the export (members) and the erase (server).
create or replace function household_photo_paths(hid uuid) returns setof text
language sql stable security definer set search_path = public, storage as $$
  select o.name from storage.objects o
  where o.bucket_id = 'photos' and o.name like hid::text || '/%'
    and (auth.uid() is null or hid in (select my_household_ids()))
$$;
revoke execute on function household_photo_paths(uuid) from public, anon;
grant execute on function household_photo_paths(uuid) to authenticated;
