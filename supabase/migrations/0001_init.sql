-- The Caregiving Menu: initial schema.
-- Every data table is scoped by household_id and protected by RLS.
-- Rows are written by the offline-first client via upsert, so there are no
-- cross-table foreign keys (push order is not guaranteed); ids are client UUIDs.

create extension if not exists pg_trgm;

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Home',
  invite_code text unique not null default substr(md5(random()::text), 1, 8),
  created_at timestamptz not null default now()
);

create table members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create or replace function my_household_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid()
$$;

-- Returns the caller's household, creating one on first sign-in.
create or replace function ensure_household() returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select household_id into hid from members where user_id = auth.uid() limit 1;
  if hid is null then
    insert into households default values returning id into hid;
    insert into members (household_id, user_id) values (hid, auth.uid());
  end if;
  return hid;
end $$;

-- Join a family member's household with their invite code.
create or replace function join_household(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into hid from households where invite_code = code;
  if hid is null then raise exception 'invalid invite code'; end if;
  insert into members (household_id, user_id) values (hid, auth.uid()) on conflict do nothing;
  return hid;
end $$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Shared columns: id, household_id, updated_at (server-stamped), deleted (soft delete).
create table ingredients (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  name text not null, aliases text[] not null default '{}', category text, default_unit text, density numeric,
  kcal_100g numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric,
  sodium_mg numeric, sugar_g numeric, potassium_mg numeric, nutrition_source text, upc text,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);
create index ingredients_name_trgm on ingredients using gin (name gin_trgm_ops);

create table recipes (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  title text not null, source_type text, source_ref text, servings numeric, prep_min int, cook_min int,
  cuisine text, meal_type text[] not null default '{}', steps jsonb not null default '[]', notes text,
  photo_path text, rating int, times_cooked int not null default 0, last_cooked_on date, kcal_per_serving numeric,
  updated_at timestamptz not null default now(), deleted boolean not null default false,
  fts tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(cuisine,'') || ' ' || coalesce(notes,''))) stored
);
create index recipes_fts on recipes using gin (fts);

create table recipe_ingredients (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  recipe_id uuid not null, ingredient_id uuid not null, qty numeric, unit text, prep_note text,
  optional boolean not null default false, group_label text, pos int not null default 0,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

create table recipe_variations (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  recipe_id uuid not null, title text, kind text, body jsonb, for_profile_id uuid, created_by text,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

create table pantry_items (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  ingredient_id uuid not null, qty numeric not null default 0, unit text, location text,
  opened_on date, expires_on date, par_qty numeric,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

create table diet_profiles (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  person_name text not null, notes text, daily_targets jsonb not null default '{}',
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

create table profile_rules (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  profile_id uuid not null, kind text not null, ingredient_id uuid, nutrient text, max_per_serving numeric,
  severity text not null default 'soft', reason text, source text,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

create table diary_entries (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  user_id uuid default auth.uid(), for_profile_id uuid, eaten_at timestamptz not null, recipe_id uuid,
  free_text text, portion_mult numeric not null default 1, photo_path text,
  kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric,
  sodium_mg numeric, sugar_g numeric, potassium_mg numeric, estimate_source text, confidence numeric,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

create table shopping_list (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  ingredient_id uuid not null, qty numeric, unit text, reason text, recipe_id uuid, done boolean not null default false,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

create table usage_log (
  id uuid primary key, household_id uuid not null references households(id) on delete cascade,
  ingredient_id uuid not null, qty numeric, unit text, event text not null, at timestamptz not null,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);

-- RLS + updated_at trigger on every data table.
do $$
declare t text;
begin
  foreach t in array array['ingredients','recipes','recipe_ingredients','recipe_variations','pantry_items',
                           'diet_profiles','profile_rules','diary_entries','shopping_list','usage_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using (household_id in (select my_household_ids())) with check (household_id in (select my_household_ids()))', t || '_household', t);
    execute format('create trigger %I before insert or update on %I for each row execute function touch_updated_at()', t || '_touch', t);
    execute format('create index %I on %I (household_id, updated_at)', t || '_sync', t);
  end loop;
end $$;

alter table households enable row level security;
create policy households_member on households for select using (id in (select my_household_ids()));
alter table members enable row level security;
create policy members_same_household on members for select using (household_id in (select my_household_ids()));

-- Private photo bucket; first path segment is the household id.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict do nothing;
create policy photos_household on storage.objects for all
  using (bucket_id = 'photos' and (storage.foldername(name))[1]::uuid in (select my_household_ids()))
  with check (bucket_id = 'photos' and (storage.foldername(name))[1]::uuid in (select my_household_ids()));
