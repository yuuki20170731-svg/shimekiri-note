-- 設定完了後にSQL Editorから一度だけ実行する。
-- Vaultに project_url と reminder_worker_secret を先に登録する。値はこのファイルへ書かない。
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('shimekiri-reminders','* * * * *',$schedule$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/reminders',
    headers := jsonb_build_object('Content-Type','application/json','x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='reminder_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$schedule$);
