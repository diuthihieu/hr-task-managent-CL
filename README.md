# Basework — HR Work Management

A relational web app for an HR team's projects, tasks and goals (OKRs).
**Browser → Next.js route handlers (auth + authorization) → Prisma → PostgreSQL.**
Every piece of business data lives in PostgreSQL and is entered by users; the
app ships with no pre-loaded business data.

- Database design, ER diagram, constraints, indexes and risks: **[docs/DATABASE.md](docs/DATABASE.md)**
- Windows desktop app (Tauri), releases and auto-updates: **[docs/DESKTOP.md](docs/DESKTOP.md)**
- Schema: [`prisma/schema.prisma`](prisma/schema.prisma) · Migrations: [`prisma/migrations/`](prisma/migrations)
- Videos and large documents (kept out of git): see [Large files](#large-files)

## Large files

Videos, slide decks and large documents live in the team Google Drive folder
([woli – videos & documents](https://drive.google.com/drive/folders/1_GzfXFTj2l_T5Tm9a7Cu7-pwPy0KhHaD)),
not in git, so cloning and CI stay fast. `.gitignore` keeps them out; put new
ones in the folder and link them here.

| What | File | Size |
|---|---|---|
| User guide video (Vietnamese) | [woli-Huong-dan-su-dung-video.mp4](https://drive.google.com/file/d/1PTUfSdQN0lgrrC9mKD_lqrmkgb0fs81y/view) | 27 MB |
| Subtitles for the user guide video | [woli-Huong-dan-su-dung-video.srt](https://drive.google.com/file/d/1TcpIYKXBtp8xZ2FAppWc-EmoowYjXkHg/view) | 8 KB |
| User guide slides | [woli-Huong-dan-su-dung.pptx](https://drive.google.com/file/d/1dEyfoRRQ5ATAX10AMlC4WuapYt5jnIXj/view) | 17 MB |
| Mobile launch video (9:16) | [woli-mobile-launch-9x16.mp4](https://drive.google.com/file/d/1oUr2K-9TzsvMlxqHETvQhawdIL3CQI9g/view) | 19 MB |
| Vibe coding with Claude Code guide | [Huong-dan-Vibe-Coding-Claude-Code.docx](https://drive.google.com/file/d/1NgsSumkLnnVg33-CnqQ_hnV7zOfyQ6G3/view) | 5 MB |

## Access model

- **Open sign-up.** Anyone can create an account on the home page (`/`);
  the sign-in and sign-up forms sit at the top, with the how-to guide, the
  benefits and the Windows download further down. An account must verify its
  email before it can create a workspace, join through a shared invite link or
  run the AI connection check. To limit new accounts to some email domains, set
  `SIGNUP_ALLOWED_DOMAINS` (people invited by email can still sign up).
- **Workspaces are self-service.** Whoever creates a workspace is its
  **owner**. Owners and admins add other people *by the email they signed up
  with* (unknown emails are rejected) and give them a role: `owner`, `admin`,
  `editor`, `contributor`, `viewer`. A user can own and join many workspaces
  and picks one on `/workspaces` after signing in. Members can leave; only
  owners delete a workspace.
- Roles are enforced by the API (`src/lib/authz.ts`) and database triggers
  block cross-workspace references. See Settings → Permissions.
- The system **Admin** console (`/admin`) still exists for support:
  deactivate/reset/delete accounts and publish desktop releases. The first
  admin is bootstrapped from `ADMIN_*` env vars.

## Features

- **Projects → Tasks** with status, category, priority, assignees (many-to-many),
  start/due dates, progress, estimate, dependencies (self-referencing
  many-to-many, cycle-checked), subtasks, importance/urgency.
- **Categories per project**, set up when the project is created (or later in
  the project's Settings tab).
- **Project objectives (OKRs).** A project can have objectives, each with any
  number of key results. Once it has one, tasks get an **Objective** field:
  pick the objective itself or one of its key results (the task then sits on
  that key result's branch). Progress rolls up from tasks → key results →
  objective (or from tasks directly when an objective has no key results).
  Project objectives appear in **Team OKRs** (grouped by project or team);
  **My OKRs** lists every objective where you are owner, contributor, key
  result owner or assignee of a linked task. **Cascading**: a key result of a
  higher objective can become someone else's objective.
- **Record pages** (`/w/…/p/…/t/<task>`): every task opens as a full page with
  its properties, a rich-text body (headings, checklists, tables, images),
  attachments with image previews, threaded comments and history.
- **Project wiki**: nested pages with the same editor, for processes,
  guidelines and meeting notes.
- **Wiki / Second Brain graph**: a permission-filtered global or local view of
  how pages, tasks, projects, OKRs, people, files and tags connect. Nodes stay
  on spaced circular rings; dragging a node places its direct links around it.
- **Views**: Table, Kanban, Calendar, Gantt, Gallery, Eisenhower, Form (optional
  public link) and **Report** - a Power BI-style view where users add charts or
  pivot tables (group by any field, split by another, count tasks or
  sum/average hours and numbers). Filters of the view apply to every chart.
- **Dashboard sheets** open as tabs (like Excel / Power BI), with live charts,
  period-over-period KPI trends, cross-filtering and per-widget formatting for
  palettes, typography, borders, backgrounds, shadows, legends, grids and
  labels.
- **Custom fields per project**, including team, location, signature, linked
  record, lookup, rollup, action button, barcode, AI, JSON and allow-listed
  API result fields; comments and attachments (Vercel Blob, private,
  served through an authorized download route), activity log on every change.
- **Personalization**: 24 accent colors, light/dark mode and Vietnamese /
  English UI, saved to the user's profile (so they follow the user to the
  desktop app).
- **Soft delete** for users, workspaces, projects, tasks, custom fields,
  comments, attachments, objectives and wiki pages; tasks can be restored.

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

Open http://localhost:3000, sign up, create a workspace and a project (with
its categories and, optionally, objectives). Teammates sign up themselves and
you add them in Settings → Members & roles.

Optional, local only: `npm run db:seed` loads a small, clearly-labelled
`[DEV]` sample workspace for UI work. It refuses to run against a non-local
database or in production.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve |
| `npm test` | Unit tests: formula engine, query engine, OKR math |
| `npm run test:e2e` | Playwright browser suite (needs `DATABASE_URL`; starts the app itself): readiness and sign-in smoke tests, the service worker's push / click handling, on iPhone + Android viewports every main screen checked for sideways scrolling, cut-off or squeezed text, plus the phone tab bar, menu and pinch-zoom lock, and on a desktop screen the task grid (editing each kind of cell, sub-tasks, inserting / deleting rows, the side panel, the frozen name column) |
| `npm run test:integration` | Creates a throwaway database, applies migrations, starts the built app and runs HTTP tests for auth, roles, constraints, triggers, soft delete and activity logs (run `npm run build` first). One ordered scenario split into chapters under `tests/integration/api/` |
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
   `DIRECT_URL`, `AUTH_SECRET`, optionally `ADMIN_EMAIL` / `ADMIN_NAME` /
   `ADMIN_PASSWORD` (system admin for the support console),
   `BLOB_READ_WRITE_TOKEN` (connect a Blob store to the project - needed for
   attachments and images in pages), `CRON_SECRET`, optionally
   `API_FIELD_ALLOWED_HOSTS`, and `DESKTOP_RELEASE_TOKEN`. Authentication,
   sign-up, public forms and computed-field refreshes use atomic PostgreSQL
   rate limits across serverless instances; a Vercel Firewall remains useful
   as an additional perimeter control.
2. The `vercel-build` script runs `prisma migrate deploy` and the admin
   bootstrap on **production** builds only, then `next build`. Preview builds
   skip migrations unless `MIGRATE_ON_PREVIEW=1`, so a feature branch can't
   migrate a shared production database.
3. After the first production deploy, sign in as the admin and remove
   `ADMIN_PASSWORD` from the environment.
4. Configure an uptime probe for `GET /api/health`. Vercel Cron calls the
   authenticated activity-log archive route daily; retention defaults to 365
   days and is configurable with `ACTIVITY_LOG_RETENTION_DAYS`.

## Project structure

```
prisma/
  schema.prisma                 normalized schema (UUID PKs, snake_case tables)
  migrations/                   the only way the schema changes
  bootstrap-admin.ts            first admin, idempotent
  seed.ts                       DEV-ONLY sample data (guarded)
src/
  app/api/                      route handlers, one folder per resource (thin: validate, check access, call a service)
  app/(app)/                    signed-in pages (workspace, project, OKRs, settings, admin)
  server/<domain>/              domain services: notifications, tasks (values, read, write, recurrence, mutations)
  lib/access.ts                 the access model's plain parts (roles, support access, request context)
  lib/authz.ts                  session → active user → workspace role checks
  lib/project-permissions.ts    per-project rights (owner, delegated capabilities)
  lib/task-grid.ts              tasks ⇄ field/record adapter used by all views (re-exports server/tasks)
  lib/activity.ts               activity log writer (same transaction as the change)
  lib/storage.ts                Vercel Blob upload/download/delete
  lib/rich-text.ts              allow-list sanitizer for record/wiki page HTML
  lib/i18n/messages/            UI text by app area (English + Vietnamese side by side)
  lib/theme-colors.ts           accent palettes (see app/accent-palettes.css)
  lib/validation.ts             zod schemas for request bodies
  components/                   views (grid, kanban, ...), OKR, admin, settings
tests/integration/              HTTP tests against a real database (one ordered scenario, chapters in api/)
e2e/                            Playwright: phone layouts, app shell, desktop grid / views / sidebar, service worker
docs/DATABASE.md                ERD, constraints, indexes, risks
docs/adr/                       architecture decisions (service layer, Web Push hook)
```
