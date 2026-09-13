import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForKeyResult } from "@/lib/permissions";
import { resolveObjectives, OBJECTIVE_INCLUDE_ARG } from "@/lib/okr-resolver";

// Search across every table in the workspace for candidate task records to
// link to this Key Result - the same "scan every table's primary field"
// approach the global search endpoint already uses.
export async function GET(req: Request, { params }: { params: Promise<{ keyResultId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { keyResultId } = await params;
  const workspaceId = await getWorkspaceIdForKeyResult(keyResultId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  const linked = await prisma.keyResultTask.findMany({ where: { keyResultId }, select: { recordId: true } });
  const linkedIds = new Set(linked.map((l) => l.recordId));

  const tables = await prisma.tableDef.findMany({
    where: { base: { workspaceId } },
    include: { base: { select: { id: true, name: true } }, fields: { where: { isPrimary: true }, take: 1 } },
  });

  const results: { tableId: string; tableName: string; baseName: string; recordId: string; title: string }[] = [];
  for (const t of tables) {
    const primary = t.fields[0];
    if (!primary) continue;
    const rows = await prisma.record.findMany({ where: { tableId: t.id }, take: 300 });
    for (const r of rows) {
      if (linkedIds.has(r.id)) continue;
      const data = JSON.parse(r.data || "{}");
      const title = String(data[primary.id] ?? "");
      if (!q || title.toLowerCase().includes(q)) {
        results.push({ tableId: t.id, tableName: t.name, baseName: t.base.name, recordId: r.id, title });
        if (results.length >= 25) break;
      }
    }
    if (results.length >= 25) break;
  }

  return NextResponse.json(results);
}

export async function POST(req: Request, { params }: { params: Promise<{ keyResultId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { keyResultId } = await params;
  const workspaceId = await getWorkspaceIdForKeyResult(keyResultId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { tableId, recordId, weight } = body;
  if (!tableId || !recordId) return NextResponse.json({ error: "tableId and recordId are required" }, { status: 400 });

  await prisma.keyResultTask.upsert({
    where: { keyResultId_recordId: { keyResultId, recordId } },
    create: { keyResultId, tableId, recordId, weight: weight ?? 1 },
    update: { weight: weight ?? 1 },
  });

  // Keep the record's own Objective/Key Result cell fields (if any exist on
  // its table) in sync so the Grid reflects the link made from the OKR side.
  const kr = await prisma.keyResult.findUnique({ where: { id: keyResultId }, select: { objectiveId: true } });
  const fields = await prisma.field.findMany({ where: { tableId, type: { in: ["okr_objective", "okr_key_result"] } } });
  if (fields.length && kr) {
    const record = await prisma.record.findUnique({ where: { id: recordId } });
    if (record) {
      const data = JSON.parse(record.data || "{}");
      for (const f of fields) {
        if (f.type === "okr_key_result") data[f.id] = keyResultId;
        if (f.type === "okr_objective") data[f.id] = kr.objectiveId;
      }
      await prisma.record.update({ where: { id: recordId }, data: { data: JSON.stringify(data) } });
    }
  }

  const objective = await prisma.objective.findUnique({ where: { id: kr!.objectiveId }, include: OBJECTIVE_INCLUDE_ARG });
  const [row] = await resolveObjectives([objective!]);
  return NextResponse.json(row, { status: 201 });
}
