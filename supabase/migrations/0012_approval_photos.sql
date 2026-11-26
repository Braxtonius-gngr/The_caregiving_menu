-- Join approval and several photos per entry.
--
-- Approval: someone who opens an invite link waits until an owner approves them. Until then
-- they see nothing and can write nothing (every policy goes through the three helper
-- functions below, which now count only approved members). Existing members stay approved.
--
-- Photos: an entry keeps its first photo and its "after" photo where they are; any further
-- photos are rows in entry_photos, one per photo, in the same private bucket.

alter table members add column if not exists approved boolean not null default true;

create or replace function my_household_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid() and approved
$$;
create or replace function my_writable_household_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid() and approved and role in ('owner', 'caregiver')
$$;
create or replace function my_owned_household_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid() and approved and role = 'owner'
$$;

create or replace function require_owner(hid uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from members where household_id = hid and user_id = auth.uid() and role = 'owner' and approved) then
    raise exception 'only an owner can do that';
  end if;
end $$;

-- A new member waits for approval. Someone already in the family keeps their standing.
create or replace function join_household(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid; r text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select i.household_id, i.role into hid, r from household_invites i where i.code = join_household.code and not i.revoked;
  if hid is null then raise exception 'That invite link is not valid any more. Ask an owner for a new one.'; end if;
  insert into members (household_id, user_id, via_invite, role, approved) values (hid, auth.uid(), true, r, false)
    on conflict (household_id, user_id) do update set via_invite = true, joined_at = now(),
      role = case when members.role = 'owner' then 'owner'
                  when members.role = 'caregiver' or excluded.role = 'caregiver' then 'caregiver'
                  else 'viewer' end;
  return hid;
end $$;

-- 'pending' until approved, so the app can say "waiting for an owner".
create or replace function my_role(hid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when approved then role else 'pending' end from members where household_id = hid and user_id = auth.uid()
$$;

drop function if exists household_members(uuid);
create function household_members(hid uuid)
returns table (user_id uuid, display_name text, email text, role text, joined_at timestamptz, is_me boolean, approved boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if hid not in (select my_household_ids()) then raise exception 'not a member of that household'; end if;
  return query select m.user_id, m.display_name, u.email::text, m.role, m.joined_at, m.user_id = auth.uid(), m.approved
    from members m left join auth.users u on u.id = m.user_id
    where m.household_id = hid
      -- people waiting are shown to owners only
      and (m.approved or hid in (select my_owned_household_ids()))
    order by m.approved, (m.role = 'owner') desc, m.joined_at;
end $$;

create or replace function approve_member(hid uuid, uid uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner(hid);
  if new_role not in ('owner', 'caregiver', 'viewer') then raise exception 'unknown role'; end if;
  update members set approved = true, role = new_role where household_id = hid and user_id = uid;
end $$;

-- A person waiting can still set their name, so the owner knows who is asking.
create or replace function set_my_name(hid uuid, new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update members set display_name = nullif(left(trim(new_name), 40), '') where household_id = hid and user_id = auth.uid();
end $$;

-- ---------- several photos per entry ----------
create table if not exists entry_photos (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  entry_id uuid not null, entry_store text not null default 'diary_entries',
  photo_path text, pos int not null default 0, caption text,
  user_id uuid default auth.uid(), edited_by uuid,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);
create index if not exists entry_photos_sync on entry_photos (household_id, updated_at);
create index if not exists entry_photos_entry on entry_photos (entry_id);
alter table entry_photos enable row level security;
drop policy if exists entry_photos_read on entry_photos;
drop policy if exists entry_photos_insert on entry_photos;
drop policy if exists entry_photos_update on entry_photos;
drop policy if exists entry_photos_delete on entry_photos;
create policy entry_photos_read on entry_photos for select using (household_id in (select my_household_ids()));
create policy entry_photos_insert on entry_photos for insert with check (household_id in (select my_writable_household_ids()));
create policy entry_photos_update on entry_photos for update using (household_id in (select my_writable_household_ids())) with check (household_id in (select my_writable_household_ids()));
create policy entry_photos_delete on entry_photos for delete using (household_id in (select my_owned_household_ids()));
drop trigger if exists entry_photos_touch on entry_photos;
create trigger entry_photos_touch before insert or update on entry_photos for each row execute function touch_updated_at();
drop trigger if exists entry_photos_author on entry_photos;
create trigger entry_photos_author before insert or update on entry_photos for each row execute function stamp_author();
