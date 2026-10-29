# Soft delete: how deleted rows stay hidden (BUG-12)

18 models are soft-deleted: deleting sets `deletedAt` and the row stays, so it can be restored and
the history stays intact. Every read has to leave those rows out. The filter is written by hand,
around 350 times, and forgetting it in a new query shows deleted data again.

**User, Workspace, Project, Task, CustomField, Comment, Attachment, Objective, KeyResult, WikiPage,
KnowledgeDoc, AgentSkill, AgentOutput, Wiki, WikiComment, Decision, Kudos, Reward.**

## Decision: a CI guard, not a Prisma extension that filters automatically

The review suggested a `prisma.$extends` that adds `deletedAt: null` to every read of these models.
We measured first, and chose a guard instead:

- **A global filter changes the behaviour of code that works today.** It applies to *root* reads.
  247 of those on these models carry no `deletedAt` in their own `where` (TypeScript AST count, Oct
  2026). Most are `findUnique` / `findUniqueOrThrow` by id after an access check that has already
  excluded deleted rows. A few read deleted rows on purpose and decide in code:
  - **Sign-in** (`src/lib/auth.ts`) looks users up by Google / Microsoft subject. A deleted account
    has to be found there to get `account_disabled`. If it were hidden, sign-in would try to create
    the user again and fail on the unique subject (P2002).
  - **Copying tasks and projects** (`src/lib/task-transfer.ts`, `src/lib/project-transfer.ts`)
    deliberately reads deleted comments and fields:
    - deleted comments are copied with their replies; without them, the replies would turn into
      top-level comments;
    - deleted custom fields are skipped deliberately, not lost.
  - **Restoring a task** (`src/server/tasks/mutations.ts`, `deletedAt: { not: null }`).
  - **Counting deleted tasks** before a project move (`src/lib/project-transfer.ts`).
  - **Showing the name or avatar of a deleted person** (`src/lib/mentions-server.ts`,
    `src/lib/push.ts`, the user avatar route, the wiki page reviewer, saved reports).
- **It would still not cover everything:**
  - relations inside `include` / `select`;
  - relation filters (`some` / `every` / `none`);
  - `_count`;
  - raw SQL (18 files use `$queryRaw` / `$executeRaw`);
  - writes.

  So the existing hand-written filters could not be removed anyway.
- **The extended client has a different type.** Its `tx` doesn't fit `Prisma.TransactionClient` (TS2345).
  That means changing 32 type declarations and the roughly 47 lines that use them.

The real risk is a *new* query that forgets the filter. The guard catches exactly that and changes
nothing at run time.

## The guard: `scripts/check-soft-delete.mjs`

It runs in Web CI on every push and pull request, and is unit-tested in
`src/lib/__tests__/soft-delete-check.test.ts`. It fails when a change adds a read (find*, count,
aggregate, groupBy) of one of these models that has either:

- a written-out `where` with no `deletedAt` condition, at the top level or inside `AND` / `OR` / `NOT`
  (a relation's `deletedAt` doesn't count), or
- no `where` at all.

What to do when it fails:

- Add `deletedAt: null`, or
- if the read must see deleted rows, put this on the line above:
  `// soft-delete: <why this read includes deleted rows>`

The reads that already exist are recorded per file and query in `scripts/soft-delete-baseline.json`.
A file may drop below its count but never go above it. After removing reads, refresh the file with
`node scripts/check-soft-delete.mjs --update`.

What it can't see, so reviews still check these:

- a `where` built elsewhere (a variable, or a spread helper such as `access.task`,
  `visibleWikiWhere()` or `ownedProjectsWhere()` — these helpers add `deletedAt` themselves);
- nested relations in `include` / `select`;
- raw SQL.

## Found while planning

- **BUG-12a:** the Home page's "Recent activity" showed deleted tasks, and the tasks and objectives of
  deleted projects. Its lookup by id had no `deletedAt` filter. Fixed in its own pull request, with a test.
- Every other read without a filter in its `where` was checked:
  - the rest of the 97 list / count reads use a helper that filters `deletedAt`, look rows up by id
    for display, compute a sort order, or are the deliberate cases listed above;
  - the `findUnique` reads follow an access check.

## If a global filter is wanted later

1. Export `type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]` and
   `type Db = Tx | typeof prisma` from `src/lib/prisma.ts`, and replace the local aliases.
2. Keep the global `omit` options.
3. Add a second client, `prismaWithDeleted`, for the deliberate reads above.
4. Include `findUniqueOrThrow` / `findFirstOrThrow`.
5. Skip any query whose `where` (including `AND` / `OR` / `NOT`) already mentions `deletedAt`.
6. Before switching it on, add tests for:
   - a deleted account signing in with Google / Microsoft (must get `account_disabled`, no P2002);
   - copying a task whose deleted comment has replies;
   - copying a project that has a deleted custom field.
