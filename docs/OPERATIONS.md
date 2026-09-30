# Operations runbook

## Required configuration (the server refuses to start without it)
- `AUTH_SECRET` - at least 32 random characters (`openssl rand -base64 32`). Rotating it signs everyone out.
- `DATABASE_URL` / `DIRECT_URL`.
- Blob storage: `BLOB_READ_WRITE_TOKEN`; `BLOB_ACCESS` must match the store type (default `private`). Uploads fail
  loudly on a mismatch - they never fall back to public.

## Release (Vercel)
1. CI (`Web CI / verify`) is green: lint, types, unit, build, migration drift check, integration suite, audit.
2. **Back up the database** (Supabase: Database -> Backups, or `pg_dump "$DIRECT_URL" -Fc > backup.dump`).
3. Deploy. The build compiles the app first, then runs `prisma/check-legacy-data.mjs`, `prisma migrate deploy`
   and the one-time admin bootstrap. A failure fails the deployment and the previous version keeps serving.
   To gate migrations behind an approval, set `SKIP_BUILD_MIGRATIONS=1` and run `npm run db:release` from a
   protected release job instead.
4. Smoke test: `GET /api/health` returns `{"status":"ok","db":"ok"}`; sign in; open a project.

Migrations must be backward compatible (expand -> deploy -> contract): the previous version keeps serving until
the new one is promoted.

## Rollback
- App: promote the previous deployment in Vercel (instant). Safe as long as the last migration was additive.
- Data: restore the backup taken in step 2 (`pg_restore --clean -d "$DIRECT_URL" backup.dump`) into a new
  database first, verify row counts, then switch `DATABASE_URL`.

## Backups and recovery targets
- Supabase daily backups (PITR on paid plans). Suggested targets: RPO 24 h (1 h with PITR), RTO 4 h.
- Restore drill: once per quarter, restore the latest backup into a scratch project, run the app against it with
  `/api/health`, and record the time taken.

## Health and monitoring
- `GET /api/health` (no auth, no data): 200 when the app and database respond, 503 otherwise. Point an uptime
  monitor at it (e.g. every minute, alert after 3 failures).
- Security events (sign-in, failed sign-in, throttling, password changes, support access) are in `activity_logs`
  with IP and user agent; the table is append-only (UPDATE and DELETE are blocked by triggers). A retention purge
  must run in one transaction with `SET LOCAL app.allow_audit_purge = 'on'`.

## Break-glass support access
System admins manage accounts and releases but only see workspaces they belong to. To inspect another workspace
for support, set `ADMIN_SUPPORT_ACCESS=1`, redeploy, do the work, then remove it. Every workspace opened in this
mode gets a `support_access` entry in its activity log.

## Account recovery
- Admin console -> Reset password gives a one-time password; the user must change it before any other API works,
  and every existing session of that account is revoked.
- Unverified email (password sign-up without a mail provider): confirm ownership out of band, then Admin console
  -> "Mark email as verified".

## Self-hosting (Docker Compose)
```
AUTH_SECRET=$(openssl rand -base64 32) POSTGRES_PASSWORD=$(openssl rand -hex 16) docker compose up -d postgres
docker compose run --rm migrate        # after a backup, on every upgrade
docker compose up -d app
```
PostgreSQL is only published on 127.0.0.1. Put a TLS-terminating proxy in front of the app that overwrites
`X-Forwarded-For`, and set `AUTH_URL` to the public origin.
