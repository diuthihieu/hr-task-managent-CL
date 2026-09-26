import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/permissions";
import { parseFieldConfig } from "@/lib/field-types";
import { findFieldByRole } from "@/lib/field-roles";
import { resolveTaskProgress } from "@/lib/okr-engine";
import { getMyObjectiveRows } from "@/lib/okr-resolver";
import type { FieldRow } from "@/types";

export interface MyTaskRow {
  tableId: string;
  tableName: string;
  baseId: string;
  baseName: string;
  recordId: string;
  title: string;
  status: string | null;
  priority: string | null;
  progress: number;
  dueDate: string | null;
  importance: "important" | "not_important" | null;
  urgency: "urgent" | "not_urgent" | null;
  objectiveId: string | null;
  keyResultId: string | null;
  contributesToOkr: boolean;
}

// Scans every table in the workspace for records assigned to the current
// user via a Person/People field - there's no single fixed "Task" table, so
// this reuses the same "find the field that plays this role" heuristic the
// OKR resolver and Gantt view already rely on, rather than hardcoding a
// table name.
export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const userId = (session.user as { id: string }).id;
  const membership = await getMembership(userId, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tables = await prisma.tableDef.findMany({
    where: { base: { workspaceId } },
    include: { base: { select: { id: true, name: true } }, fields: { orderBy: { order: "asc" } } },
  });

  const krLinks = await prisma.keyResultTask.findMany({ where: { keyResult: { objective: { workspaceId } } } });
  const krLinkByRecord = new Map(krLinks.map((l) => [l.recordId, l]));

  const tasks: MyTaskRow[] = [];
  for (const table of tables) {
    const fields = table.fields as unknown as FieldRow[];
    const personField = findFieldByRole(fields, "owner", { fallbackToType: true });
    const peopleField = fields.find((f) => f.type === "people");
    if (!personField && !peopleField) continue;

    const records = await prisma.record.findMany({ where: { tableId: table.id } });
    const primaryField = fields.find((f) => f.isPrimary);
    const statusField = findFieldByRole(fields, "status");
    const priorityField = findFieldByRole(fields, "priority", { exclude: [statusField] });
    const dueDateField = findFieldByRole(fields, "due_date", { fallbackToType: true });
    const importanceField = fields.find((f) => f.type === "importance");
    const urgencyField = fields.find((f) => f.type === "urgency");
    const objectiveField = fields.find((f) => f.type === "okr_objective");
    const keyResultField = fields.find((f) => f.type === "okr_key_result");

    for (const record of records) {
      const data = JSON.parse(record.data || "{}") as Record<string, unknown>;
      const isMine = (personField && data[personField.id] === userId) || (peopleField && Array.isArray(data[peopleField.id]) && (data[peopleField.id] as string[]).includes(userId));
      if (!isMine) continue;

      const statusCfg = statusField ? parseFieldConfig(statusField.config) : null;
      const priorityCfg = priorityField ? parseFieldConfig(priorityField.config) : null;
      const keyResultId = keyResultField ? (data[keyResultField.id] as string | null) ?? null : null;

      tasks.push({
        tableId: table.id,
        tableName: table.name,
        baseId: table.base.id,
        baseName: table.base.name,
        recordId: record.id,
        title: primaryField ? String(data[primaryField.id] ?? "") : "",
        status: statusField ? statusCfg?.options?.find((o) => o.id === data[statusField.id])?.label ?? null : null,
        priority: priorityField ? priorityCfg?.options?.find((o) => o.id === data[priorityField.id])?.label ?? null : null,
        progress: resolveTaskProgress(fields, data),
        dueDate: dueDateField ? (data[dueDateField.id] as string | null) ?? null : null,
        importance: importanceField ? ((data[importanceField.id] as "important" | "not_important" | null) ?? null) : null,
        urgency: urgencyField ? ((data[urgencyField.id] as "urgent" | "not_urgent" | null) ?? null) : null,
        objectiveId: objectiveField ? (data[objectiveField.id] as string | null) ?? null : null,
        keyResultId,
        contributesToOkr: Boolean(keyResultId) || krLinkByRecord.has(record.id),
      });
    }
  }

  const objectives = await getMyObjectiveRows(workspaceId, userId);
  const keyResults = objectives.flatMap((o) => o.keyResults.map((k) => ({ ...k, objectiveTitle: o.title, objectiveId: o.id })));

  return NextResponse.json({ tasks, objectives, keyResults });
}
