import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/permissions";
import { parseFieldConfig } from "@/lib/field-types";
import type { CapturedThoughtRow } from "@/types";

export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const userId = (session.user as { id: string }).id;
  const membership = await getMembership(userId, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const thoughts = await prisma.capturedThought.findMany({
    where: { workspaceId, userId, status: { in: ["captured", "clarifying"] } },
    orderBy: { createdAt: "asc" },
  });

  const tableIds = [...new Set(thoughts.map((t) => t.tableId))];
  const tables = await prisma.tableDef.findMany({ where: { id: { in: tableIds } }, include: { fields: true } });
  const tableById = new Map(tables.map((t) => [t.id, t]));

  const rows: CapturedThoughtRow[] = thoughts.map((t) => {
    const table = tableById.get(t.tableId);
    const categoryField = table?.fields.find((f) => f.type === "single_select" || f.type === "status");
    const cfg = categoryField ? parseFieldConfig(categoryField.config) : null;
    const option = cfg?.options?.find((o) => o.id === t.categoryOptionId);
    return {
      id: t.id,
      taskName: t.taskName,
      tableId: t.tableId,
      tableName: table?.name ?? "",
      baseId: table?.baseId ?? "",
      categoryOptionId: t.categoryOptionId,
      categoryLabel: option?.label ?? null,
      categoryColor: option?.color ?? null,
      estimatedDurationMinutes: t.estimatedDurationMinutes,
      plannedAt: t.plannedAt ? t.plannedAt.toISOString() : null,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
    };
  });

  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const userId = (session.user as { id: string }).id;
  const membership = await getMembership(userId, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  if (!body.taskName?.trim() || !body.tableId) {
    return NextResponse.json({ error: "taskName and tableId are required" }, { status: 400 });
  }

  const thought = await prisma.capturedThought.create({
    data: {
      workspaceId,
      userId,
      taskName: body.taskName.trim(),
      tableId: body.tableId,
      categoryOptionId: body.categoryOptionId || null,
      estimatedDurationMinutes: body.estimatedDurationMinutes ?? null,
      plannedAt: body.plannedAt ? new Date(body.plannedAt) : null,
    },
  });
  return NextResponse.json(thought, { status: 201 });
}
