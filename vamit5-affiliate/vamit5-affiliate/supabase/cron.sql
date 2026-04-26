-- =====================================================================
-- CRON JOBS — Supabase pg_cron
-- Run this AFTER schema.sql and AFTER deploying edge functions
-- =====================================================================

-- Enable pg_cron and pg_net extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Helper: function to call edge functions
create or replace function call_edge_function(fn_name text)
returns void
language plpgsql
security definer
as $$
declare
  v_url text;
  v_anon_key text;
begin
  -- Replace these with your project values (or use vault.decrypted_secrets)
  v_url := current_setting('app.settings.supabase_url', true);
  v_anon_key := current_setting('app.settings.service_role_key', true);

  if v_url is null then
    raise exception 'Set app.settings.supabase_url first';
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_key
    ),
    body := '{}'::jsonb
  );
end;
$$;

-- Set your project values (run once)
-- alter database postgres set "app.settings.supabase_url" = 'https://YOUR-PROJECT.supabase.co';
-- alter database postgres set "app.settings.service_role_key" = 'eyJhbGc...';

-- Daily: generate today's challenges (00:01 UTC)
select cron.schedule(
  'generate-daily-challenges',
  '1 0 * * *',
  $$ select call_edge_function('generate-challenges'); $$
);

-- Daily: sync Instagram posts for all athletes (03:00 UTC)
select cron.schedule(
  'sync-instagram-posts',
  '0 3 * * *',
  $$ select call_edge_function('instagram-sync'); $$
);

-- Daily: update challenge progress, streak warnings, promotion checks (04:00 UTC)
select cron.schedule(
  'daily-checks',
  '0 4 * * *',
  $$ select call_edge_function('daily-checks'); $$
);

-- Monthly: payouts (20th of every month at 09:00 UTC)
select cron.schedule(
  'monthly-payouts',
  '0 9 20 * *',
  $$ select call_edge_function('monthly-payouts'); $$
);

-- View scheduled jobs
-- select * from cron.job;

-- To remove a job:
-- select cron.unschedule('job-name');
