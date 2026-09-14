import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForRecord } from "@/lib/permissions";
import { resolveTaskOkrWeight } from "@/lib/okr-engine";
import type { FieldRow } from "@/types";

// Keeps KeyResultTask rows (the source of truth for task-based KR progress)
// in sync whenever a record's own "okr_key_result" cell(s) or its "OKR
// Contribution Weight" field change - covers edits made directly in the
// Grid/Kanban/etc, mirroring the reverse sync in the key-results/tasks route
// (which handles linking initiated from the OKR side).
async function syncKeyResultLinks(recordId: string, tableId: string, oldData: Record<string, unknown>, newData: Record<string, unknown>) {
  const fields = (await prisma.field.findMany({ where: { tableId } })) as unknown as FieldRow[];
  const krFields = fields.filter((f) => f.type === "okr_key_result");
  if (!krFields.length) return;

  const oldKrIds = new Set(krFields.map((f) => oldData[f.id]).filter((v): v is string => typeof v === "string" && v.length > 0));
  const newKrIds = new Set(krFields.map((f) => newData[f.id]).filter((v): v is string => typeof v === "string" && v.length > 0));

  const removed = [...oldKrIds].filter((id) => !newKrIds.has(id));
  if (removed.length) {
    await prisma.keyResultTask.deleteMany({ where: { recordId, keyResultId: { in: removed } } });
  }
  if (newKrIds.size) {
    const weight = resolveTaskOkrWeight(fields, newData);
    await Promise.all(
      [...newKrIds].map((keyResultId) =>
        prisma.keyResultTask.upsert({
          where: { keyResultId_recordId: { keyResultId, recordId } },
          create: { keyResultId, tableId, recordId, weight },
          update: { weight },
        })
      )
    );
  }
}

function serialize(record: { id: string; tableId: string; data: string; order: number; createdById: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    ...record,
    data: JSON.parse(record.data || "{}"),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { recordId } = await params;
  const workspaceId = await getWorkspaceIdForRecord(recordId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const existing = await prisma.record.findUnique({ where: { id: recordId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const oldData = JSON.parse(existing.data || "{}");
  const data: Record<string, unknown> = {};
  let mergedData = oldData;
  if (body.data) {
    mergedData = { ...oldData, ...body.data };
    data.data = JSON.stringify(mergedData);
  }
  if (body.order !== undefined) data.order = body.order;

  const record = await prisma.record.update({ where: { id: recordId }, data });
  if (body.data) await syncKeyResultLinks(recordId, existing.tableId, oldData, mergedData);
  await prisma.auditLog.create({
    data: {
      workspaceId,
      userId: (session.user as { id: string }).id,
      action: "update",
      objectType: "record",
      objectId: recordId,
      oldValue: body.data ? JSON.stringify(oldData) : null,
      newValue: body.data ? JSON.stringify(mergedData) : null,
    },
  });
  return NextResponse.json(serialize(record));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { recordId } = await params;
  const workspaceId = await getWorkspaceIdForRecord(recordId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.record.delete({ where: { id: recordId } });
  await prisma.auditLog.create({
    data: { workspaceId, userId: (session.user as { id: string }).id, action: "delete", objectType: "record", objectId: recordId },
  });
  return NextResponse.json({ ok: true });
}
