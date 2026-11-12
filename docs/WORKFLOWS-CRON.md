# Scheduled workflows: the Supabase pg_cron job

Agent Work → Workflows run when something calls `POST /api/workflows/tick` with the app's `CRON_SECRET`.
On production that caller is Supabase `pg_cron` + `pg_net`, every 5 minutes. A tick answers `202` at once
and runs what is due afterwards; a workflow is claimed before it runs, so overlapping ticks are safe.

This is set up once, by the owner, in the Supabase SQL Editor. It is not a Prisma migration: plain
PostgreSQL (local, CI) has no `pg_cron`.

## 1. Extensions

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

## 2. The secret, in Vault

Use the same value as the `CRON_SECRET` environment variable on Vercel. Paste it in the SQL Editor only -
never in chat, code or a commit.

```sql
select vault.create_secret('<paste CRON_SECRET here>', 'woli_cron_secret');
```

## 3. The job

Replace the host with the production domain.

```sql
select cron.schedule(
  'woli-workflows-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://<production-domain>/api/workflows/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'woli_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
```

## Check and maintain

```sql
select jobname, schedule, active from cron.job;                                   -- the job exists
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
select status_code, created from net._http_response order by created desc limit 5; -- expect 202
select cron.unschedule('woli-workflows-tick');                                     -- stop
```

- `401` in `net._http_response`: the Vault secret differs from Vercel's `CRON_SECRET`.
- Rotating the secret: update Vercel, then `select vault.update_secret(id, '<new>')` for `woli_cron_secret`.
- Without the job nothing runs on schedule; "Run now" in the app still works.
