import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/permissions";
import { parseFieldConfig } from "@/lib/field-types";
import { detectCaptureFieldRoles } from "@/lib/capture-engine";
import type { CaptureTargetRow, FieldRow } from "@/types";

// Every non-archived table in the workspace that has a Category-like field
// can receive converted thoughts - Quick Capture picks from these instead of
// a hardcoded "the" task table, since a workspace may have more than one
// Task Base.
export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tables = await prisma.tableDef.findMany({
    where: { archived: false, base: { workspaceId, archived: false } },
    include: { base: { select: { id: true, name: true } }, fields: { orderBy: { order: "asc" } } },
  });

  const targets: CaptureTargetRow[] = [];
  for (const table of tables) {
    const fields = table.fields as unknown as FieldRow[];
    const roles = detectCaptureFieldRoles(fields);
    if (!roles.categoryField) continue;
    const categoryCfg = parseFieldConfig(roles.categoryField.config);
    const statusCfg = roles.statusField ? parseFieldConfig(roles.statusField.config) : null;
    const priorityCfg = roles.priorityField ? parseFieldConfig(roles.priorityField.config) : null;
    targets.push({
      tableId: table.id,
      tableName: table.name,
      baseId: table.base.id,
      baseName: table.base.name,
      categoryFieldId: roles.categoryField.id,
      categoryOptions: categoryCfg.options ?? [],
      statusOptions: statusCfg?.options ?? [],
      priorityOptions: priorityCfg?.options ?? [],
    });
  }

  return NextResponse.json(targets);
}
