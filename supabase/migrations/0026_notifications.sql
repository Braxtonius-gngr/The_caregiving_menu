-- Phone notifications (design: product/design/step-notifications.md, decision P-027).
-- A phone's push address and the person's choices; only that person reads or changes their own.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  prefs jsonb not null default '{}',
  device text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_household on push_subscriptions (household_id);
alter table push_subscriptions enable row level security;
drop policy if exists push_own on push_subscriptions;
create policy push_own on push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and household_id in (select my_household_ids()));

-- What was already sent to whom, so each alert goes out once. Only the server reads or writes it.
create table if not exists notifications_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table notifications_sent enable row level security;

-- Every 10 minutes. The function sends only what is due and not yet sent, so the call needs no key.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'phone-notifications';
select cron.schedule('phone-notifications', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://qhfjbdtakeagwtnhqmzk.supabase.co/functions/v1/notify',
    body := '{"action":"run"}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb)
$$);
