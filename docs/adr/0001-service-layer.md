# ADR 0001: Route handlers stay thin; domain logic lives in `src/server/<domain>/`

- Status: accepted (2026-10-28). Domains moved so far: notifications; tasks (core: values, read, write, recurrence, create / edit / delete / restore). `src/lib/task-grid.ts` re-exports `src/server/tasks` so its 21 importers keep working while they move.
- Context: 165 of 192 API route files queried Prisma directly, mixing input parsing, permission checks and business rules. The same rule (for example, which notifications are muted) was hard to find, test or reuse.

## Decision

- A route handler does three things: parse and validate input (zod), resolve the caller and their access (`src/lib/authz.ts`), and call a service. It returns the service result as JSON.
- Business rules and database access live in `src/server/<domain>/`:
  - Pure helpers (filters, calculations) go in files without `server-only` or Prisma client imports, so `npm test` can cover them directly.
  - Files that touch the database start with `import "server-only"` and take the caller (`SessionUser`) or ids as arguments. They scope every lookup to the caller themselves, so a service can't be misused by a route that forgets a check.
- Domains move over one PR at a time, when a route in that domain changes anyway. There is no big-bang migration.
- `src/lib/` keeps cross-cutting code (auth, Prisma client, i18n, shared types). Older domain helpers in `src/lib/` (for example `src/lib/notifications.ts`, which writes notifications) move only when their domain is migrated.

## Consequences

- Routes are short and uniform. Rules are unit-testable and reusable from scripts.
- Behaviour must stay identical during a move: the integration suite (`npm run test:integration`) and the browser suite (`npm run test:e2e`) are the safety net, and each move ships with tests for the extracted pure helpers.
