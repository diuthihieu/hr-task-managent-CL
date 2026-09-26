// ============================================================================
// DEVELOPMENT SEED - NOT FOR PRODUCTION.
//
// Creates a small, obviously-fake sample workspace so a developer can click
// around locally. It refuses to run when NODE_ENV=production, on Vercel, or
// against a non-local database unless ALLOW_DEV_SEED=1 is set explicitly.
// Production data is always entered by users; production deploys only run
// `prisma/bootstrap-admin.ts`, which creates the first admin account and
// nothing else.
//
//   npm run db:seed        # local only
// ============================================================================

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createWorkspace } from "../src/lib/workspace-setup";
import { createTask, SYS } from "../src/lib/task-grid";

const prisma = new PrismaClient();

function assertDevEnvironment() {
  const url = process.env.DATABASE_URL ?? "";
  const local = /@(localhost|127\.0\.0\.1|postgres|db)(:\d+)?\//.test(url);
  if (process.env.ALLOW_DEV_SEED === "1") return;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL || !local) {
    console.error("[dev-seed] Refusing to seed: this is not a local development database. Set ALLOW_DEV_SEED=1 to override.");
    process.exit(1);
  }
}

function day(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function main() {
  assertDevEnvironment();
  if (await prisma.workspace.findFirst({ where: { name: "[DEV] Sample Workspace" } })) {
    console.log("[dev-seed] Sample workspace already exists - nothing to do.");
    return;
  }
  const password = process.env.DEV_SEED_PASSWORD || "devpassword1";
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@example.test" },
    update: {},
    create: { email: "admin@example.test", name: "Dev Admin", passwordHash, systemRole: "ADMIN", mustChangePassword: false },
  });
  const member = await prisma.user.upsert({
    where: { email: "member@example.test" },
    update: {},
    create: { email: "member@example.test", name: "Dev Member", passwordHash, systemRole: "MEMBER", mustChangePassword: false, avatarColor: "#0ea5e9", createdById: admin.id },
  });

  await prisma.$transaction(async (tx) => {
    const ws = await createWorkspace(tx, { name: "[DEV] Sample Workspace", ownerId: admin.id });
    await tx.workspaceMember.create({ data: { workspaceId: ws.id, userId: member.id, role: "editor", createdById: admin.id } });
    const [catA, catB] = await Promise.all([
      tx.category.create({ data: { workspaceId: ws.id, name: "Sample Category A", color: "#6366f1", sortOrder: 0, createdById: admin.id } }),
      tx.category.create({ data: { workspaceId: ws.id, name: "Sample Category B", color: "#22c55e", sortOrder: 1, createdById: admin.id } }),
    ]);
    const project = await tx.project.create({
      data: {
        workspaceId: ws.id,
        name: "[DEV] Sample Project",
        ownerId: admin.id,
        createdById: admin.id,
        views: { create: [{ name: "All Tasks", type: "grid", isDefault: true, sortOrder: 0 }, { name: "Board", type: "kanban", sortOrder: 1, config: { kanban: { groupFieldId: SYS.status } } }] },
      },
    });
    const objective = await tx.objective.create({ data: { workspaceId: ws.id, title: "[DEV] Sample objective", ownerId: admin.id, createdById: admin.id } });
    const kr = await tx.keyResult.create({ data: { objectiveId: objective.id, title: "[DEV] Sample key result", createdById: admin.id } });
    const inProgress = await tx.status.findFirstOrThrow({ where: { workspaceId: ws.id, category: "in_progress" } });
    const t1 = await createTask(tx, {
      projectId: project.id,
      workspaceId: ws.id,
      actorId: admin.id,
      data: { [SYS.title]: "[DEV] Sample task 1", [SYS.category]: catA.id, [SYS.assignees]: [member.id], [SYS.startDate]: day(-2), [SYS.dueDate]: day(5), [SYS.keyResult]: kr.id, [SYS.status]: inProgress.id, [SYS.progress]: 40 },
    });
    await createTask(tx, {
      projectId: project.id,
      workspaceId: ws.id,
      actorId: admin.id,
      data: { [SYS.title]: "[DEV] Sample task 2", [SYS.category]: catB.id, [SYS.assignees]: [admin.id], [SYS.dueDate]: day(10), [SYS.dependsOn]: [t1], [SYS.keyResult]: kr.id },
    });
  });
  console.log(`[dev-seed] Done. Sign in with admin@example.test or member@example.test / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
