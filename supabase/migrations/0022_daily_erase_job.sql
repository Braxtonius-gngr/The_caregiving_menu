-- Every day at 04:17 UTC, erase families whose 7 days have passed (function /account, action purge).
-- The function only erases families already past their date, so the call needs no key.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'erase-due-families';
select cron.schedule('erase-due-families', '17 4 * * *', $$
  select net.http_post(
    url := 'https://qhfjbdtakeagwtnhqmzk.supabase.co/functions/v1/account',
    body := '{"action":"purge"}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb)
$$);
