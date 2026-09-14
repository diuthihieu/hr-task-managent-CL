import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForThought } from "@/lib/permissions";
import { detectCaptureFieldRoles } from "@/lib/capture-engine";
import type { FieldRow } from "@/types";

// Clarify -> Convert to Task: the one place a captured thought turns into a
// real Record in its target Task table. The thought row is kept (marked
// converted) rather than deleted, so there's an audit trail from thought to
// task; the dot disappears purely because the client stops listing
// non-"captured"/"clarifying" thoughts.
export async function POST(req: Request, { params }: { params: Promise<{ thoughtId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  const { thoughtId } = await params;
  const workspaceId = await getWorkspaceIdForThought(thoughtId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership(userId, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const thought = await prisma.capturedThought.findUnique({ where: { id: thoughtId } });
  if (!thought || thought.userId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (thought.status === "converted") return NextResponse.json({ error: "Already converted" }, { status: 400 });

  const body = await req.json();
  const table = await prisma.tableDef.findUnique({ where: { id: thought.tableId }, include: { fields: true } });
  if (!table) return NextResponse.json({ error: "Target table no longer exists" }, { status: 404 });
  const fields = table.fields as unknown as FieldRow[];
  const roles = detectCaptureFieldRoles(fields);

  let objectiveId: string | null = body.objectiveId || null;
  if (!objectiveId && body.newObjectiveTitle?.trim()) {
    const created = await prisma.objective.create({
      data: { workspaceId, title: body.newObjectiveTitle.trim(), ownerId: userId, status: "not_started" },
    });
    objectiveId = created.id;
  }

  const data: Record<string, unknown> = {};
  if (roles.primaryField) data[roles.primaryField.id] = thought.taskName;
  if (roles.categoryField && thought.categoryOptionId) data[roles.categoryField.id] = thought.categoryOptionId;
  if (roles.durationField && thought.estimatedDurationMinutes) {
    data[roles.durationField.id] = roles.durationField.type === "duration" ? thought.estimatedDurationMinutes : Math.round((thought.estimatedDurationMinutes / 60) * 10) / 10;
  }
  if (roles.startField && body.startAt) data[roles.startField.id] = body.startAt;
  if (roles.dueField && body.dueAt) data[roles.dueField.id] = body.dueAt;
  if (roles.statusField && body.status) data[roles.statusField.id] = body.status;
  if (roles.priorityField && body.priority) data[roles.priorityField.id] = body.priority;
  if (roles.outputField && body.output) data[roles.outputField.id] = body.output;
  if (roles.processField && body.process) data[roles.processField.id] = body.process;
  if (roles.ownerField) data[roles.ownerField.id] = body.ownerId || userId;
  if (roles.objectiveField && objectiveId) data[roles.objectiveField.id] = objectiveId;
  if (roles.keyResultField && body.keyResultId) data[roles.keyResultField.id] = body.keyResultId;

  const autoNumberFields = fields.filter((f) => f.type === "auto_number");
  if (autoNumberFields.length) {
    const count = await prisma.record.count({ where: { tableId: table.id } });
    for (const f of autoNumberFields) data[f.id] = count + 1;
  }

  const maxOrder = await prisma.record.aggregate({ where: { tableId: table.id }, _max: { order: true } });
  const record = await prisma.record.create({
    data: {
      tableId: table.id,
      data: JSON.stringify(data),
      order: (maxOrder._max.order ?? 0) + 1,
      createdById: userId,
    },
  });

  if (body.keyResultId) {
    await prisma.keyResultTask.upsert({
      where: { keyResultId_recordId: { keyResultId: body.keyResultId, recordId: record.id } },
      create: { keyResultId: body.keyResultId, tableId: table.id, recordId: record.id, weight: 1 },
      update: {},
    });
  }

  await prisma.auditLog.create({
    data: { workspaceId, userId, action: "create", objectType: "record", objectId: record.id, newValue: JSON.stringify({ convertedFromThought: thoughtId }) },
  });

  const updatedThought = await prisma.capturedThought.update({
    where: { id: thoughtId },
    data: { status: "converted", convertedRecordId: record.id, convertedAt: new Date() },
  });

  return NextResponse.json({ record, thought: updatedThought, baseId: table.baseId, tableId: table.id });
}
