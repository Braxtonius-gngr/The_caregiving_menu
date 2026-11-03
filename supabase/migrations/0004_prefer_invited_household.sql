-- A family member's device may create a personal household on its first sync and
-- then join the shared one with an invite code, possibly while that first sync is
-- still running. Every later device must land in the household they were invited
-- to, so invite memberships are marked and preferred, most recently joined first.
alter table members add column if not exists via_invite boolean not null default false;
alter table members add column if not exists joined_at timestamptz not null default now();

create or replace function join_household(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into hid from households where invite_code = code;
  if hid is null then raise exception 'invalid invite code'; end if;
  insert into members (household_id, user_id, via_invite) values (hid, auth.uid(), true)
    on conflict (household_id, user_id) do update set via_invite = true, joined_at = now(); -- rejoining makes it the newest choice again
  return hid;
end $$;

create or replace function ensure_household() returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select household_id into hid from members where user_id = auth.uid()
    order by via_invite desc, joined_at desc limit 1;
  if hid is null then
    insert into households default values returning id into hid;
    insert into members (household_id, user_id) values (hid, auth.uid());
  end if;
  return hid;
end $$;
