import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForKeyResult } from "@/lib/permissions";
import { resolveObjectives, OBJECTIVE_INCLUDE_ARG } from "@/lib/okr-resolver";

export async function PATCH(req: Request, { params }: { params: Promise<{ keyResultId: string; linkId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { keyResultId, linkId } = await params;
  const workspaceId = await getWorkspaceIdForKeyResult(keyResultId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  await prisma.keyResultTask.update({ where: { id: linkId }, data: { weight: body.weight } });

  const objective = await prisma.objective.findUnique({
    where: { id: (await prisma.keyResult.findUnique({ where: { id: keyResultId }, select: { objectiveId: true } }))!.objectiveId },
    include: OBJECTIVE_INCLUDE_ARG,
  });
  const [row] = await resolveObjectives([objective!]);
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ keyResultId: string; linkId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { keyResultId, linkId } = await params;
  const workspaceId = await getWorkspaceIdForKeyResult(keyResultId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const link = await prisma.keyResultTask.delete({ where: { id: linkId } });

  // Clear the record's own Key Result cell field if it was pointing here.
  const fields = await prisma.field.findMany({ where: { tableId: link.tableId, type: "okr_key_result" } });
  if (fields.length) {
    const record = await prisma.record.findUnique({ where: { id: link.recordId } });
    if (record) {
      const data = JSON.parse(record.data || "{}");
      let changed = false;
      for (const f of fields) {
        if (data[f.id] === keyResultId) {
          data[f.id] = null;
          changed = true;
        }
      }
      if (changed) await prisma.record.update({ where: { id: link.recordId }, data: { data: JSON.stringify(data) } });
    }
  }

  const objective = await prisma.objective.findUnique({
    where: { id: (await prisma.keyResult.findUnique({ where: { id: keyResultId }, select: { objectiveId: true } }))!.objectiveId },
    include: OBJECTIVE_INCLUDE_ARG,
  });
  const [row] = await resolveObjectives([objective!]);
  return NextResponse.json(row);
}
