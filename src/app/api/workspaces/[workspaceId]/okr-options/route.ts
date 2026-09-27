import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route } from "@/lib/authz";

type P = { workspaceId: string };

/** Lightweight Objective / Key Result titles for pickers (task links, cascading alignment). */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const [objectives, keyResults] = await Promise.all([
    prisma.objective.findMany({
      where: { workspaceId, deletedAt: null, OR: [{ projectId: null }, { project: { deletedAt: null } }] },
      select: { id: true, title: true, teamId: true, projectId: true, project: { select: { name: true } } },
      orderBy: { title: "asc" },
    }),
    prisma.keyResult.findMany({ where: { deletedAt: null, objective: { workspaceId, deletedAt: null } }, select: { id: true, title: true, objectiveId: true }, orderBy: { title: "asc" } }),
  ]);
  return NextResponse.json({
    objectives: objectives.map((o) => ({ id: o.id, title: o.title, teamId: o.teamId, projectId: o.projectId, projectName: o.project?.name ?? null })),
    keyResults,
  });
});
