# Basework — HR Work Management

A relational web app for an HR team's projects, tasks and goals (OKRs).
**Browser → Next.js route handlers (auth + authorization) → Prisma → PostgreSQL.**
Every piece of business data lives in PostgreSQL and is entered by users; the
app ships with no pre-loaded business data.

- Database design, ER diagram, constraints, indexes and risks: **[docs/DATABASE.md](docs/DATABASE.md)**
- Windows desktop app (Tauri), releases and auto-updates: **[docs/DESKTOP.md](docs/DESKTOP.md)**
- Schema: [`prisma/schema.prisma`](prisma/schema.prisma) · Migrations: [`prisma/migrations/`](prisma/migrations)

## Access model

- **No self-service sign-up.** A system **Admin** creates accounts in the
  Admin console (`/admin`). New accounts get a one-time temporary password and
  must choose their own password at first sign-in.
- Admins also create workspaces, reset passwords, deactivate or delete
  accounts. Deactivation takes effect on the very next request.
- Inside a workspace, roles are `owner`, `admin`, `editor`, `contributor`,
  `viewer`. They are enforced by the API (`src/lib/authz.ts`), and database
  triggers block cross-workspace references. See Settings → Permissions.

## Features

- **Projects → Tasks** with status, category, priority, assignees (many-to-many),
  start/due dates, progress, estimate, dependencies (self-referencing
  many-to-many, cycle-checked), subtasks, importance/urgency, key-result link.
- **Custom fields per project** (text, number, currency, percent, rating,
  checkbox, date/time, single/multi select, person, URL, email, phone,
  formula), stored as typed values with normalized options.
- **Views**: Grid, Kanban, Calendar, Gantt, Gallery, Eisenhower, Form (optional
  public link). Filters, sorts, grouping, conditional formatting, saved views.
- **Comments**, **attachments** (Vercel Blob, private, served through an
  authorized download route), **activity log** on every important change.
- **Goals (OKR)**: objectives → key results → tasks; progress derived at read
  time. My Work, OKR dashboard, workspace dashboards, quick capture inbox,
  CSV import (transactional) and CSV/Excel export.
- **Soft delete** for users, workspaces, projects, tasks, custom fields,
  comments, attachments, objectives; tasks can be restored.

## Web and Desktop

The same app runs in the browser and as a Windows desktop app
(`desktop/`, Tauri 2 + WebView2). The desktop app is a native window onto
the same web app, so both share one backend, one login, one set of
permissions and one PostgreSQL database - no business data is stored on the
PC. Users download it from `/download` (linked in the sidebar and on the
sign-in page); the button always serves the latest published installer.
Releasing a new version is a tag push - see [docs/DESKTOP.md](docs/DESKTOP.md).

## Getting started (local)

Requires Node 20+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env              # DATABASE_URL / DIRECT_URL / AUTH_SECRET / ADMIN_EMAIL
docker compose up postgres -d     # optional local Postgres matching .env.example
npm run db:migrate                # prisma migrate deploy
npm run admin:bootstrap           # creates the first admin from ADMIN_* (prints a temp password)
npm run dev                       # http://localhost:3000
```

Sign in with the admin account, set your password, then in the Admin console
create a workspace and the accounts for your team. Add categories under
Settings → Categories and create the first project from the sidebar.

Optional, local only: `npm run db:seed` loads a small, clearly-labelled
`[DEV]` sample workspace for UI work. It refuses to run against a non-local
database or in production.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve |
| `npm test` | Unit tests: formula engine, query engine, OKR math |
| `npm run test:integration` | Creates a throwaway database, applies migrations, starts the built app and runs HTTP tests for auth, roles, constraints, triggers, soft delete and activity logs (run `npm run build` first) |
| `npm run lint` | ESLint |
| `npm run db:migrate` | `prisma migrate deploy` |
| `npm run admin:bootstrap` | Create the first admin if none exists |
| `npm run db:seed` | Development sample data (local only) |
| `cd desktop && npm run dev` / `npm run build` | Run / package the Windows desktop app (see docs/DESKTOP.md) |

To change the schema: edit `prisma/schema.prisma`, run
`npx prisma migrate dev --name <change>`, commit the generated migration.
Never alter the database by hand.

## Deploying to Vercel

1. Environment variables (Production and Preview): `DATABASE_URL`,
   `DIRECT_URL`, `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_NAME`, optionally
   `ADMIN_PASSWORD`, `BLOB_READ_WRITE_TOKEN` (connect a Blob store to the
   project) and `DESKTOP_RELEASE_TOKEN` (desktop release registration).
2. The `vercel-build` script runs `prisma migrate deploy` and the admin
   bootstrap on **production** builds only, then `next build`. Preview builds
   skip migrations unless `MIGRATE_ON_PREVIEW=1`, so a feature branch can't
   migrate a shared production database.
3. After the first production deploy, sign in as the admin and remove
   `ADMIN_PASSWORD` from the environment.

## Project structure

```
prisma/
  schema.prisma                 normalized schema (UUID PKs, snake_case tables)
  migrations/                   the only way the schema changes
  bootstrap-admin.ts            first admin, idempotent
  seed.ts                       DEV-ONLY sample data (guarded)
src/
  app/api/                      route handlers, one folder per resource
  app/(app)/                    signed-in pages (workspace, project, OKRs, settings, admin)
  lib/authz.ts                  session → active user → workspace role checks
  lib/task-grid.ts              tasks ⇄ field/record adapter used by all views
  lib/activity.ts               activity log writer (same transaction as the change)
  lib/storage.ts                Vercel Blob upload/download/delete
  lib/validation.ts             zod schemas for request bodies
  components/                   views (grid, kanban, ...), OKR, admin, settings
tests/integration/              HTTP tests against a real database
docs/DATABASE.md                ERD, constraints, indexes, risks
```
