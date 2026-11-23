-- Family sharing: roles, invite links per role, names, who-logged-it, and an edit history.
--
-- Roles: owner (manages the family and its invite links), caregiver (adds and edits
-- entries), viewer (reads only). Writes are enforced here, not just hidden in the app.
-- Invite links carry a role. Codes are only visible to owners.

-- ---------- roles ----------
alter table members add column if not exists role text not null default 'caregiver'
  check (role in ('owner', 'caregiver', 'viewer'));

-- Whoever made a household owns it; joiners stay caregivers.
update members set role = 'owner' where via_invite = false;
-- Every household keeps at least one owner (its earliest member).
update members m set role = 'owner'
from (select distinct on (household_id) household_id, user_id from members order by household_id, joined_at) f
where m.household_id = f.household_id and m.user_id = f.user_id
  and not exists (select 1 from members o where o.household_id = m.household_id and o.role = 'owner');

create or replace function my_writable_household_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid() and role in ('owner', 'caregiver')
$$;
create or replace function my_owned_household_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid() and role = 'owner'
$$;

-- Read for every member; write only for owners and caregivers. Hard deletes are owner-only
-- (the app soft-deletes, so a slip can always be undone).
do $$
declare t text;
begin
  foreach t in array array['ingredients','recipes','recipe_ingredients','recipe_variations','pantry_items',
                           'diet_profiles','profile_rules','diary_entries','shopping_list','usage_log'] loop
    execute format('drop policy if exists %I on %I', t || '_household', t);
    execute format('create policy %I on %I for select using (household_id in (select my_household_ids()))', t || '_read', t);
    execute format('create policy %I on %I for insert with check (household_id in (select my_writable_household_ids()))', t || '_insert', t);
    execute format('create policy %I on %I for update using (household_id in (select my_writable_household_ids())) with check (household_id in (select my_writable_household_ids()))', t || '_update', t);
    execute format('create policy %I on %I for delete using (household_id in (select my_owned_household_ids()))', t || '_delete', t);
  end loop;
end $$;

-- Photos: same split. The first folder of every path is the household id (compared as text,
-- see 0005).
drop policy if exists photos_household on storage.objects;
create policy photos_read on storage.objects for select
  using (bucket_id = 'photos' and (storage.foldername(name))[1] in (select my_household_ids()::text));
create policy photos_insert on storage.objects for insert
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] in (select my_writable_household_ids()::text));
create policy photos_update on storage.objects for update
  using (bucket_id = 'photos' and (storage.foldername(name))[1] in (select my_writable_household_ids()::text))
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] in (select my_writable_household_ids()::text));
create policy photos_delete on storage.objects for delete
  using (bucket_id = 'photos' and (storage.foldername(name))[1] in (select my_writable_household_ids()::text));

-- Household names are readable by members; invite codes are not (only through invite_links()).
revoke select on households from anon, authenticated;
grant select (id, name, created_at) on households to authenticated;

-- ---------- invite links ----------
create table if not exists household_invites (
  code text primary key default replace(gen_random_uuid()::text, '-', ''),
  household_id uuid not null references households(id) on delete cascade,
  role text not null check (role in ('caregiver', 'viewer')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);
alter table household_invites enable row level security;
create policy household_invites_owner on household_invites for select
  using (household_id in (select my_owned_household_ids()));

-- Links already sent out keep working as caregiver links.
insert into household_invites (code, household_id, role)
  select invite_code, id, 'caregiver' from households on conflict do nothing;

create or replace function require_owner(hid uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from members where household_id = hid and user_id = auth.uid() and role = 'owner') then
    raise exception 'only an owner can do that';
  end if;
end $$;

-- The current caregiver and viewer codes, creating any that are missing. Owners only.
create or replace function invite_links(hid uuid) returns table (role text, code text)
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  perform require_owner(hid);
  foreach r in array array['caregiver', 'viewer'] loop
    if not exists (select 1 from household_invites i where i.household_id = hid and i.role = r and not i.revoked) then
      insert into household_invites (household_id, role) values (hid, r);
    end if;
  end loop;
  return query select i.role, i.code from household_invites i
    where i.household_id = hid and not i.revoked order by i.role, i.created_at desc;
end $$;

-- Cancel every link sent so far and make new ones. Owners only.
create or replace function reset_invite_links(hid uuid) returns table (role text, code text)
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner(hid);
  update household_invites set revoked = true where household_id = hid;
  update households set invite_code = replace(gen_random_uuid()::text, '-', '') where id = hid;
  return query select * from invite_links(hid);
end $$;

-- Join with a link's code. An existing member is never demoted by a lower-role link.
create or replace function join_household(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid; r text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select i.household_id, i.role into hid, r from household_invites i where i.code = join_household.code and not i.revoked;
  if hid is null then raise exception 'That invite link is not valid any more. Ask an owner for a new one.'; end if;
  insert into members (household_id, user_id, via_invite, role) values (hid, auth.uid(), true, r)
    on conflict (household_id, user_id) do update set via_invite = true, joined_at = now(),
      role = case when members.role = 'owner' then 'owner'
                  when members.role = 'caregiver' or excluded.role = 'caregiver' then 'caregiver'
                  else 'viewer' end;
  return hid;
end $$;

-- ---------- people ----------
create or replace function household_members(hid uuid)
returns table (user_id uuid, display_name text, email text, role text, joined_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if hid not in (select my_household_ids()) then raise exception 'not a member of that household'; end if;
  return query select m.user_id, m.display_name, u.email::text, m.role, m.joined_at, m.user_id = auth.uid()
    from members m left join auth.users u on u.id = m.user_id
    where m.household_id = hid order by (m.role = 'owner') desc, m.joined_at;
end $$;

create or replace function my_role(hid uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from members where household_id = hid and user_id = auth.uid()
$$;

create or replace function set_my_name(hid uuid, new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update members set display_name = nullif(left(trim(new_name), 40), '') where household_id = hid and user_id = auth.uid();
end $$;

create or replace function set_household_name(hid uuid, new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner(hid);
  update households set name = coalesce(nullif(left(trim(new_name), 60), ''), 'Home') where id = hid;
end $$;

-- Change someone's role. A household always keeps at least one owner.
create or replace function set_member_role(hid uuid, uid uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner(hid);
  if new_role not in ('owner', 'caregiver', 'viewer') then raise exception 'unknown role'; end if;
  if new_role <> 'owner' and (select role from members where household_id = hid and user_id = uid) = 'owner'
     and (select count(*) from members where household_id = hid and role = 'owner') <= 1 then
    raise exception 'Make someone else an owner first. Every family needs one.';
  end if;
  update members set role = new_role where household_id = hid and user_id = uid;
end $$;

-- Remove someone (owners), or leave yourself (anyone). The last owner can't leave.
create or replace function remove_member(hid uuid, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if uid <> auth.uid() then perform require_owner(hid); end if;
  if (select role from members where household_id = hid and user_id = uid) = 'owner'
     and (select count(*) from members where household_id = hid and role = 'owner') <= 1 then
    raise exception 'Make someone else an owner first. Every family needs one.';
  end if;
  delete from members where household_id = hid and user_id = uid;
end $$;

-- ---------- who logged it ----------
alter table diary_entries add column if not exists edited_by uuid;

-- The author is set once by the server; every write records who made it.
create or replace function stamp_author() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.user_id := coalesce(new.user_id, auth.uid());
  else new.user_id := coalesce(old.user_id, new.user_id); end if;
  new.edited_by := coalesce(auth.uid(), new.edited_by);
  return new;
end $$;
drop trigger if exists diary_entries_author on diary_entries;
create trigger diary_entries_author before insert or update on diary_entries
  for each row execute function stamp_author();

-- ---------- edit history ----------
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  household_id uuid not null,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete', 'restore')),
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_row jsonb,
  new_row jsonb
);
create index if not exists audit_log_row on audit_log (household_id, table_name, row_id, changed_at desc);
alter table audit_log enable row level security;
create policy audit_log_read on audit_log for select using (household_id in (select my_household_ids()));

-- Records every change to health records. Photo bytes and search columns are left out;
-- a write that changes nothing but the timestamp is not recorded.
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; act text;
begin
  n := to_jsonb(new) - 'photo_data' - 'after_photo_data' - 'fts';
  if tg_op = 'UPDATE' then
    o := to_jsonb(old) - 'photo_data' - 'after_photo_data' - 'fts';
    if (o - 'updated_at' - 'edited_by') = (n - 'updated_at' - 'edited_by') then return null; end if;
    act := case when new.deleted and not old.deleted then 'delete'
                when old.deleted and not new.deleted then 'restore' else 'update' end;
  else act := 'insert'; end if;
  insert into audit_log (household_id, table_name, row_id, action, changed_by, old_row, new_row)
    values (new.household_id, tg_table_name, new.id, act, auth.uid(), o, n);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['diary_entries', 'diet_profiles', 'profile_rules'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update on %I for each row execute function audit_row()', t || '_audit', t);
  end loop;
end $$;
