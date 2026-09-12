# Basework — Internal Work Management Platform

An Airtable/Lark-Base-style workspace → base → table → view engine, built as a
production-oriented foundation for an internal work management platform. This
is **Phase 1 (Foundation) and Phase 2 (Data Interaction)** of the roadmap
below — a fully working vertical slice, not a mockup.

## What's implemented

- **Auth** — email/password (NextAuth v5, credentials + JWT sessions).
- **Workspace → Base → Table → Field → Record** — fully dynamic schema; adding
  a field never touches SQL DDL.
- **Grid view** — inline editing per field type, column resize/reorder/freeze,
  hide fields, row drag-to-reorder, bulk select + delete, record drawer with
  comments, add-field type picker (grouped by category, matching the spec's
  field taxonomy).
- **Saved views** — multiple Grid views per table, each with its own filters,
  sorts, grouping, hidden columns, column order/widths and conditional
  formatting, persisted server-side.
- **Filter engine** — AND/OR condition groups, per-type operators (text,
  number, date, select, person, current-user).
- **Group engine** — collapsible groups with count/sum/avg/min/max summaries.
- **Conditional formatting** — cell or row highlight rules.
- **Formula fields** — small real expression engine (`IF`, `AND`, `OR`, `NOT`,
  `CONCAT`, `LEFT/RIGHT/MID/LEN/UPPER/LOWER`, `TODAY/NOW/YEAR/MONTH/DAY/DATE_DIFF`,
  `SUM/AVG/MIN/MAX`, arithmetic and comparisons) evaluated live against a
  record's current field values.
- **Relational (basic)** — Link-to-Record fields with a picker over the
  target table's records.
- **Global search** — Ctrl/Cmd+K across bases, tables and records.
- **Light/dark theme**, toasts, empty states, keyboard-friendly inputs.
- **Seed data** — a "BESTARION" workspace with an "HR Operations" base:
  All Tasks, Employee, Social Insurance, Training, Audit Log, with realistic
  linked records and several saved views (All Tasks, My Tasks, Overdue Tasks,
  Completed Tasks, By Category).

Kanban/Calendar/Gantt/Gallery/Form views, the Dashboard builder, the Workflow
builder, and fine-grained permissions are **intentionally not built yet** —
see "Roadmap" below. Their schema is already in place (`View.type`,
`Dashboard`, `DashboardBlock`, `Workflow`, `WorkflowNode`,
`WorkflowExecution`) so adding them is additive, not a rewrite. The sidebar
and view-type picker show these as disabled "soon" entries so the full
information architecture is visible today.

## Getting started

```bash
npm install
npx prisma migrate dev   # creates prisma/dev.db (SQLite) and applies the schema
npm run db:seed          # seeds the BESTARION / HR Operations demo data
npm run dev
```

Open http://localhost:3000 and sign in with the seeded demo account:

- **Email:** `diuthihieu@gmail.com`
- **Password:** `password123`

Or register a new account from the login page — you'll get your own empty
workspace.

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

### Database provider: SQLite (dev) vs PostgreSQL (production)

The spec asks for PostgreSQL. This repo's local development environment
(the sandbox this was built in) had no Docker/Postgres available, so
`prisma/schema.prisma` is currently set to `provider = "sqlite"` — every
type used (`String`, `Int`, `Float`, `Boolean`, `DateTime`, JSON-as-`String`)
is Postgres-compatible, so switching is a two-line change:

1. In `prisma/schema.prisma`, change `provider = "sqlite"` to
   `provider = "postgresql"` under `datasource db`.
2. Point `DATABASE_URL` at your Postgres instance (see `docker-compose.yml`,
   which already runs Postgres 16 for you) and run
   `npx prisma migrate dev --name init` once against it.

`docker-compose.yml` and the `Dockerfile` build the production image against
Postgres already; `docker compose up` after the schema switch will build the
app, run migrations, and serve it on port 3000.

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
    filters/             # filter/sort/group/conditional-format popovers
    fields/              # add/edit field dialog
    ui/                   # small Radix-based primitives (button, dialog, popover, ...)
  lib/
    query-engine.ts      # filter / sort / group / conditional-formatting (shared by every view type)
    formula.ts           # formula field tokenizer/parser/evaluator
    field-types.ts        # the field type registry (drives the add-field picker)
    auth.ts, prisma.ts, permissions.ts, api-client.ts, utils.ts
  types/                  # shared TS types for API payloads
```

## Roadmap (see the product spec for full detail)

- **Phase 3 — Task experience:** Kanban (drag between status groups),
  Calendar, Gantt, Gallery, Form view; subtasks/dependencies/watchers.
- **Phase 4 — Analytics:** dashboard builder, chart blocks, KPI cards,
  page/chart-level filters.
- **Phase 5 — Automation:** visual trigger → condition → action workflow
  editor, execution history.
- **Phase 6 — Advanced data:** two-way relationships, Lookup, Rollup fields
  (schema and field-type entries already exist, marked "coming soon" in the
  UI).
- **Phase 7 — Enterprise:** field-level permissions, audit log UI (the
  `AuditLog` model exists, unused so far), SSO (Entra ID/Google — the
  NextAuth provider list is the extension point), API, perf work on the
  query engine described above.

Each phase should start by inspecting the current code, since the schema was
deliberately built to absorb these without a restructure.
