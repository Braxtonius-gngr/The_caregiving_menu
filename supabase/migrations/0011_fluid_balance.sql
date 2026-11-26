-- Fluid balance and daily weight.
-- Outputs (urine, vomit, stool, drain) are diary entries of their own kind, with no
-- nutrition. Meals can carry the fluid in one serving (soup, Jell-O, ice cream).
-- Weights live in a new measurements table (later also blood pressure, sugar, oxygen).
-- Limits and alert levels sit on the person's profile and start blank: the care team sets them.
-- The family's day runs from a start hour (default 6 am), so late-night entries count
-- toward the day before.

alter table diary_entries drop constraint if exists diary_entries_entry_kind_check;
alter table diary_entries add constraint diary_entries_entry_kind_check
  check (entry_kind in ('meal', 'drink', 'output'));
alter table diary_entries add column if not exists output_type text
  check (output_type in ('urine', 'vomit', 'stool', 'drain', 'none', 'other'));
alter table diary_entries add column if not exists output_color text;
alter table diary_entries add column if not exists clots boolean;
alter table diary_entries add column if not exists fluid_ml numeric check (fluid_ml >= 0);

alter table diet_profiles add column if not exists care_settings jsonb not null default '{}';

create table if not exists measurements (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  for_profile_id uuid, kind text not null check (kind in ('weight', 'blood_pressure', 'glucose', 'oxygen', 'temperature')),
  value numeric not null, value2 numeric, unit text, taken_at timestamptz not null,
  standard boolean not null default false, note text,
  user_id uuid default auth.uid(), edited_by uuid,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);
create index if not exists measurements_sync on measurements (household_id, updated_at);
alter table measurements enable row level security;
drop policy if exists measurements_read on measurements;
drop policy if exists measurements_insert on measurements;
drop policy if exists measurements_update on measurements;
drop policy if exists measurements_delete on measurements;
create policy measurements_read on measurements for select using (household_id in (select my_household_ids()));
create policy measurements_insert on measurements for insert with check (household_id in (select my_writable_household_ids()));
create policy measurements_update on measurements for update using (household_id in (select my_writable_household_ids())) with check (household_id in (select my_writable_household_ids()));
create policy measurements_delete on measurements for delete using (household_id in (select my_owned_household_ids()));
drop trigger if exists measurements_touch on measurements;
create trigger measurements_touch before insert or update on measurements for each row execute function touch_updated_at();
drop trigger if exists measurements_author on measurements;
create trigger measurements_author before insert or update on measurements for each row execute function stamp_author();
drop trigger if exists measurements_audit on measurements;
create trigger measurements_audit after insert or update on measurements for each row execute function audit_row();

-- The family's day start.
alter table households add column if not exists day_start_hour int not null default 6
  check (day_start_hour between 0 and 23);
grant select (day_start_hour) on households to authenticated;

create or replace function set_day_start(hid uuid, hour int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner(hid);
  if hour < 0 or hour > 23 then raise exception 'hour must be 0 to 23'; end if;
  update households set day_start_hour = hour where id = hid;
end $$;
