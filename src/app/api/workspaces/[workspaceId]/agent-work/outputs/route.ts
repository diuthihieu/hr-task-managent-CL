import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, visibleProjectWhere } from "@/lib/authz";

type P = { workspaceId: string };

export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const url = new URL(req.url);
  const search = url.searchParams.get("q")?.trim().slice(0, 200);
  const skillId = url.searchParams.get("skillId") || undefined;
  const projectId = url.searchParams.get("projectId") || undefined;
  const rawType = url.searchParams.get("type");
  const type = rawType && ["markdown", "text", "json", "file"].includes(rawType) ? (rawType as "markdown" | "text" | "json" | "file") : null;
  const rows = await prisma.agentOutput.findMany({
    where: {
      workspaceId,
      createdById: user.id,
      deletedAt: null,
      OR: [{ projectId: null }, { project: { deletedAt: null, ...visibleProjectWhere(user) } }],
      ...(search ? { filename: { contains: search, mode: "insensitive" } } : {}),
      ...(skillId ? { skillId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(type ? { type } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, filename: true, type: true, mimeType: true, sizeBytes: true, createdAt: true, runId: true, task: { select: { id: true, title: true } }, project: { select: { id: true, name: true } }, skill: { select: { id: true, name: true } } },
  });
  return NextResponse.json(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })));
});
