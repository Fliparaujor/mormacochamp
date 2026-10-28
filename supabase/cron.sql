-- Cron a cada minuto chamando o tick do app (Supabase: pg_cron + pg_net).
-- 1) Database > Extensions: ligue pg_cron e pg_net (ou rode as duas linhas abaixo).
-- 2) Troque SEU-DOMINIO e SEU-CRON-SECRET e rode no SQL Editor.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('arena-tick') where exists (select 1 from cron.job where jobname = 'arena-tick');
select cron.schedule(
  'arena-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-DOMINIO/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer SEU-CRON-SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
