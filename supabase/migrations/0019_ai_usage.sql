-- AI cost per family. The brain function writes one row per Claude call (server key only);
-- members of the family can read their own rows. Each household has a monthly AI allowance.
create table if not exists ai_usage (
  id bigserial primary key,
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid,
  feature text not null,
  model text,
  input_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  output_tokens int not null default 0,
  web_searches int not null default 0,
  cost_cents numeric(10, 3) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_household_month on ai_usage (household_id, created_at);
alter table ai_usage enable row level security;
create policy ai_usage_read on ai_usage for select using (household_id in (select my_household_ids()));
-- No insert/update/delete policies: only the server (service role) writes.

-- Monthly AI allowance in cents; null = no limit. Families that exist when this runs (the
-- founding family) get no limit; families created later start at $10.
alter table households add column if not exists ai_allowance_cents int default 1000;
update households set ai_allowance_cents = null;

-- This month's AI cost for a family the caller belongs to (cents).
create or replace function ai_cost_this_month(hid uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_cents), 0) from ai_usage
  where household_id = hid and hid in (select my_household_ids())
    and created_at >= date_trunc('month', now())
$$;
grant execute on function ai_cost_this_month(uuid) to authenticated;
