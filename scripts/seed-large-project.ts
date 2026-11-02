// ============================================================================
// PERFORMANCE SEED - DEVELOPMENT DATABASES ONLY (BUG-06a / BUG-07).
//
// Creates a project with SEED_TASKS tasks (default 5000) for measuring the task grid and
// edits of lookup / rollup fields. Link structure (so BUG-07's measurement means something):
//   - one custom link field "Related";
//   - exactly one task titled PERF-TARGET links to exactly 3 tasks, which link nowhere;
//   - no other task has a link value;
//   - every 50th task gets a sub-task (one level, no deep parent chains);
//   - SEED_WITH_ROLLUP=1 adds a rollup "Related count" (count over "Related").
// Never a chain linking the whole project (task i -> i+1): then every edit legitimately
// needs the whole project and the numbers mean nothing.
//
// Refuses to run unless SEED_LARGE_CONFIRM=yes and the database host is local
// (localhost, 127.0.0.1, ::1, postgres, db). Not for production, not on Vercel.
//
//   SEED_LARGE_CONFIRM=yes SEED_WITH_ROLLUP=1 npx tsx scripts/seed-large-project.ts
// ============================================================================
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "postgres", "db"]);

function assertSafe() {
  const raw = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(raw).hostname;
  } catch {
    // unparsable: refused below
  }
  if (process.env.SEED_LARGE_CONFIRM !== "yes" || !LOCAL_HOSTS.has(host) || process.env.NODE_ENV === "production" || process.env.VERCEL) {
    console.error(`[seed-large] Refusing to run: set SEED_LARGE_CONFIRM=yes, and DATABASE_URL must point at a local database (got host "${host || "?"}").`);
    process.exit(1);
  }
}

async function main() {
  assertSafe();
  const n = Math.max(10, Math.min(50_000, Number(process.env.SEED_TASKS ?? 5000)));
  const withRollup = process.env.SEED_WITH_ROLLUP === "1";
  // The first workspace owned by a system admin (create one in the app first).
  const member = await prisma.workspaceMember.findFirst({ where: { role: "owner", workspace: { deletedAt: null }, user: { systemRole: "ADMIN", deletedAt: null } }, orderBy: { createdAt: "asc" }, select: { workspaceId: true, user: true } });
  if (!member) throw new Error("No workspace owned by a system admin - sign in as the admin and create one first");
  const admin = member.user;
  const workspaceId = member.workspaceId;
  const status = await prisma.status.findFirst({ where: { workspaceId }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] });
  if (!status) throw new Error("The workspace has no statuses");

  const project = await prisma.project.create({ data: { workspaceId, name: `Perf ${n}${withRollup ? " + rollup" : ""} ${new Date().toISOString().slice(0, 16)}`, createdById: admin.id, ownerId: admin.id } });
  const link = await prisma.customField.create({ data: { projectId: project.id, name: "Related", type: "link", sortOrder: 0, settings: { maxLinks: 20 } } });
  if (withRollup) await prisma.customField.create({ data: { projectId: project.id, name: "Related count", type: "rollup", sortOrder: 1, settings: { lookupLinkFieldId: link.id, lookupFieldId: "", rollupFn: "count" } } });

  const base = { workspaceId, projectId: project.id, statusId: status.id, createdById: admin.id };
  const titles = Array.from({ length: n }, (_, i) => (i === 0 ? "PERF-TARGET" : `Perf task ${i}`));
  for (let i = 0; i < n; i += 1000) {
    await prisma.task.createMany({ data: titles.slice(i, i + 1000).map((title, j) => ({ ...base, title, sortOrder: i + j })) });
  }
  const tasks = await prisma.task.findMany({ where: { projectId: project.id }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  const [target, a, b, c] = tasks;
  await prisma.taskCustomFieldValue.create({ data: { taskId: target.id, customFieldId: link.id, valueTaskIds: [a.id, b.id, c.id] } });
  const parents = tasks.filter((_, i) => i > 3 && i % 50 === 0);
  await prisma.task.createMany({ data: parents.map((p, k) => ({ ...base, title: `Perf sub-task ${k}`, parentTaskId: p.id, sortOrder: n + k })) });
  console.log(`[seed-large] project ${project.id}: ${n + parents.length} tasks, PERF-TARGET ${target.id}${withRollup ? ", rollup on Related" : ""}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
