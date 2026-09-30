// Pre-migration guard. The 2026-09-26 normalized-schema migration drops the
// prototype's tables without copying their data. Before `prisma migrate
// deploy`, refuse to continue when that migration is still pending on a
// database whose legacy tables hold rows - unless ALLOW_LEGACY_DROP=1 is set
// after taking a backup. Fresh databases and already-migrated ones pass.
import { PrismaClient } from "@prisma/client";

const DESTRUCTIVE = "20260926140000_normalized_relational_schema";
const LEGACY = ["User", "Workspace", "WorkspaceMember", "Base", "TableDef", "Field", "Record", "Attachment", "AuditLog", "Objective", "KeyResult", "Comment", "Dashboard"];

const prisma = new PrismaClient();
try {
  const hasLog = await prisma.$queryRawUnsafe(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS ok`);
  if (hasLog[0].ok) {
    const applied = await prisma.$queryRawUnsafe(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL`, DESTRUCTIVE);
    if (applied.length) process.exit(0);
  }
  const withRows = [];
  for (const t of LEGACY) {
    const exists = await prisma.$queryRawUnsafe(`SELECT to_regclass('public."${t}"') IS NOT NULL AS ok`);
    if (!exists[0].ok) continue;
    const n = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`);
    if (n[0].n > 0) withRows.push(`${t} (${n[0].n})`);
  }
  if (withRows.length && process.env.ALLOW_LEGACY_DROP !== "1") {
    console.error(`[migrate-guard] Pending migration ${DESTRUCTIVE} would DELETE legacy data: ${withRows.join(", ")}.`);
    console.error("[migrate-guard] Back up the database, export what you need, then re-run with ALLOW_LEGACY_DROP=1.");
    process.exit(1);
  }
} finally {
  await prisma.$disconnect();
}
