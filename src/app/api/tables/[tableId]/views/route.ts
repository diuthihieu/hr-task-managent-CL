import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForTable } from "@/lib/permissions";
import { IMPORTANCE_OPTIONS, URGENCY_OPTIONS } from "@/lib/field-types";

export async function POST(req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tableId } = await params;
  const workspaceId = await getWorkspaceIdForTable(tableId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const count = await prisma.view.count({ where: { tableId } });
  let config = body.config || {};

  // First Eisenhower view on this table: make sure it has somewhere to
  // read/write Importance & Urgency, instead of opening onto an empty
  // "no field to place cards" state every time.
  if (body.type === "eisenhower") {
    let importanceField = await prisma.field.findFirst({ where: { tableId, type: "importance" } });
    let urgencyField = await prisma.field.findFirst({ where: { tableId, type: "urgency" } });
    const baseOrder = await prisma.field.count({ where: { tableId } });
    if (!importanceField) {
      importanceField = await prisma.field.create({
        data: { tableId, name: "Importance", type: "importance", order: baseOrder, config: JSON.stringify({ options: IMPORTANCE_OPTIONS }) },
      });
    }
    if (!urgencyField) {
      urgencyField = await prisma.field.create({
        data: { tableId, name: "Urgency", type: "urgency", order: baseOrder + 1, config: JSON.stringify({ options: URGENCY_OPTIONS }) },
      });
    }
    config = { ...config, eisenhower: { importanceFieldId: importanceField.id, urgencyFieldId: urgencyField.id, urgentWithinDays: 3, ...config.eisenhower } };
  }

  const view = await prisma.view.create({
    data: {
      tableId,
      name: body.name || "New View",
      type: body.type || "grid",
      config: JSON.stringify(config),
      order: count,
    },
  });
  return NextResponse.json(view, { status: 201 });
}
