# Basework — Internal Work Management Platform

An Airtable/Lark-Base-style workspace → base → table → view engine, built as an
internal work management platform for an HR Operations team: one master task
table viewed many ways, aligned to Team OKRs, with a quick-capture inbox in
front of it.

## What's implemented

**Data engine**
- **Auth** — email/password (NextAuth v5, credentials + JWT sessions).
- **Workspace → Base → Table → Field → Record** — fully dynamic schema; adding
  a field never touches SQL DDL.
- **Filter engine** (AND/OR groups, per-type operators incl. current user),
  **sorts**, **grouping** with count/sum/avg/min/max, **conditional formatting**.
- **Formula fields** — `IF`, `AND`, `OR`, `NOT`, `CONCAT`,
  `LEFT/RIGHT/MID/LEN/UPPER/LOWER`, `TODAY/NOW/YEAR/MONTH/DAY/DATE_DIFF`,
  `SUM/AVG/MIN/MAX`, arithmetic and comparisons.
- **Link-to-Record** fields; **global search** (Ctrl/Cmd+K).
- **Field roles** — My Work, OKR progress and Put All Things On find a table's
  Status / Priority / Category / Start / Due / Owner / Duration / Output /
  Execution-plan fields by an explicit **Role** set in the field editor, or
  else by an English *or Vietnamese* name match ("Trạng thái", "Hạn chót",
  "Người phụ trách"...). See `src/lib/field-roles.ts`.

**Views** (all saved server-side, each with its own filters/sorts/grouping/
hidden columns/formatting; rename, duplicate, reorder, "Save as View")
- Grid (inline editing, resize/reorder/freeze columns, row drag, bulk delete,
  record drawer with comments, row height incl. auto-fit), Kanban, Calendar,
  Gantt, Gallery, Eisenhower matrix, and Form (public link at `/form/[viewId]`).
- CSV/Excel export; CSV import (columns matched to fields by name).

**Work management**
- **Task Base** — the HR Operations base is organised around one master task
  table; legacy per-domain tables are archived, not deleted.
- **Team OKRs** — Teams, Objectives, Key Results (task-based, numeric,
  percentage, manual); tasks link to KRs through `okr_objective` /
  `okr_key_result` fields. Progress is computed at read time, never stored.
  Pages: Team OKRs, My OKRs, Objective detail, OKR dashboard.
- **My Work** — personal hub: my tasks, OKRs, key results, Eisenhower summary,
  upcoming deadlines.
- **Put All Things On** — quick-capture inbox with duration + planned time, a
  time-ring visualization (Today / This Week / Next / Later / Unplanned) and a
  clarify flow that turns a thought into a task linked to a Key Result.
- **Dashboards** — multi-widget builder (KPI + chart types, filter bar) and a
  workspace-wide dashboard index.
- **Settings** — workspace info, members & roles, permission matrix, task
  statuses/priorities/categories, default fields, views, notifications,
  appearance, import/export, integrations, audit log (record create/update/
  delete is logged), security.

**Not built yet:** the Workflow/Automation builder (schema only: `Workflow`,
`WorkflowNode`, `WorkflowExecution`), Lookup/Rollup fields, field-level
permissions, SSO — see "Roadmap".

## Getting started

Requires Node 20+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env            # set DATABASE_URL / DIRECT_URL and AUTH_SECRET
docker compose up postgres -d   # optional: local Postgres matching .env.example
npx prisma migrate deploy       # apply migrations (use `migrate dev` when changing the schema)
npm run db:seed                 # BESTARION / HR Operations demo data
npm run dev
```

Open http://localhost:3000 and sign in with the seeded demo account:

- **Email:** `demo@basework.local`
- **Password:** `password123`

Set `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` in `.env` before seeding to create
the demo account under your own login instead. Or register from the login page
— you'll get your own empty workspace.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit tests (Node test runner via `tsx`) for the formula engine, query engine, OKR math and field-role detection |
| `npm run lint` | ESLint |
| `npm run db:seed` | `prisma db seed` (loads `.env`) |

## Architecture

```
Workspace
  └── Base
       ├── Table (Field[], Record[], View[])
       ├── Dashboard (schema only, Phase 4)
       └── Workflow (schema only, Phase 5)
```

### Dynamic-field storage strategy

The spec calls for a schema that supports arbitrary custom fields **without**
a new physical SQL column per field, without collapsing to a single JSON
blob, and while preserving indexing/relationships/aggregation potential.
This app uses a **hybrid relational + JSON** model:

- `Workspace`, `Base`, `TableDef`, `Field`, `View` are fully relational rows.
  Creating a custom field inserts a `Field` row (id, name, type, config,
  order, visibility...) — there is never a schema migration for user-defined
  columns.
- `Record.data` is a single JSON column keyed by `Field.id`
  (`{ [fieldId]: value }`). This is the standard Airtable/Baserow-style cell
  store: one row read = one full record (no N-way join against a
  value-per-cell table), while every field's *type, validation and
  relationships* stay fully relational and queryable through `Field`.
- This is **not** "one giant blob": the blob is scoped to a single record's
  cells, driven by strongly-typed field metadata that lives in real rows.
  Filtering, sorting, grouping and conditional formatting are implemented as
  a shared query engine (`src/lib/query-engine.ts`) operating on this shape.

**Known v1 simplification:** filter/sort/group run in the application layer
over a table's already-fetched records, not pushed down to SQL. This is
correct and fast at the scale of a single table's rows (hundreds–low
thousands) but is the first thing to change for very large tables — the
natural next step is a denormalized `RecordValue` index table (typed columns
per field, indexed by `fieldId` + value) written alongside `Record.data` for
the specific fields a query needs to filter/sort on. The schema comment in
`prisma/schema.prisma` documents this path; it wasn't built now to avoid
over-engineering a v1 with no scale problem yet.

### Database provider: PostgreSQL

`prisma/schema.prisma` targets PostgreSQL, with a separate `directUrl` for
migrations. This matters when the database sits behind a connection pooler
(e.g. Supabase's Supavisor, or any serverless deployment target like Vercel):
`DATABASE_URL` should point at the pooled/transaction-mode endpoint (used by
Prisma Client at runtime), and `DIRECT_URL` at an unpooled/session-mode
endpoint (used only by Prisma Migrate). See `.env.example` for both a local
Docker Compose setup and a hosted-Postgres (Supabase) setup.

`docker-compose.yml` and the `Dockerfile` build the production image against
Postgres; `docker compose up` will build the app, run migrations, and serve
it on port 3000.

### Folder structure

```
prisma/
  schema.prisma        # data model (see above)
  seed.ts               # HR Operations demo data
src/
  app/
    (app)/w/[workspaceSlug]/b/[baseId]/t/[tableId]/   # the main table+view page
    api/                                              # REST-ish route handlers, one per resource
    login/
  components/
    layout/             # sidebar/topbar shell, command palette (Ctrl+K)
    views/               # view tabs, toolbar, the table-workspace orchestrator
    grid/                # the data grid, per-field-type cell editor, record drawer
    kanban/ calendar/ gantt/ gallery/ eisenhower/ form/   # the other view types
    okr/ capture/ dashboard/ settings/                     # OKRs, Put All Things On, dashboards, settings
    filters/             # filter/sort/group/conditional-format popovers
    fields/              # add/edit field dialog
    ui/                   # small Radix-based primitives (button, dialog, popover, ...)
  lib/
    query-engine.ts      # filter / sort / group / conditional-formatting (shared by every view type)
    formula.ts           # formula field tokenizer/parser/evaluator
    field-types.ts        # the field type registry (drives the add-field picker)
    field-roles.ts        # maps conceptual roles (status, due date, owner...) to a table's real fields
    okr-engine.ts, okr-resolver.ts   # OKR progress math + read-side aggregation
    capture-engine.ts     # Put All Things On field mapping + time-ring math
    dashboard-engine.ts   # dashboard widget aggregation
    __tests__/            # unit tests (`npm test`)
    auth.ts, prisma.ts, permissions.ts, api-client.ts, utils.ts
  types/                  # shared TS types for API payloads
```

## Roadmap

Done: Phase 1–2 (foundation, data interaction), Phase 3 views (Kanban,
Calendar, Gantt, Gallery, Form, Eisenhower), Phase 4 dashboards, Team OKRs,
audit log.

- **Automation:** visual trigger → condition → action workflow editor and
  execution history (schema exists). Start with concrete HR triggers — overdue
  tasks, social-insurance deadlines, expiring training certificates.
- **Task depth:** subtasks, dependencies, watchers.
- **Advanced data:** two-way relationships, Lookup, Rollup fields (field-type
  entries exist, marked "coming soon").
- **Enterprise:** field-level permissions, SSO (Entra ID/Google — the NextAuth
  provider list is the extension point), public API, SQL push-down for the
  query engine described above.

Each phase should start by inspecting the current code; the schema was built
to absorb these without a restructure.
