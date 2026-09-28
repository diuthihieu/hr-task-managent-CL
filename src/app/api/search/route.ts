import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, visibleProjectWhere } from "@/lib/authz";

/** Ctrl/Cmd+K: projects and tasks by name, case-insensitive, in SQL. */
export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const workspaceId = url.searchParams.get("workspaceId");
  if (!q || !workspaceId) return NextResponse.json({ projects: [], tasks: [] });
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const [projects, tasks] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId, deletedAt: null, ...visibleProjectWhere(user), name: { contains: q, mode: "insensitive" } }, select: { id: true, name: true, color: true }, take: 6 }),
    prisma.task.findMany({
      where: { workspaceId, deletedAt: null, project: { deletedAt: null, ...visibleProjectWhere(user) }, title: { contains: q, mode: "insensitive" } },
      select: { id: true, title: true, project: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 15,
    }),
  ]);
  return NextResponse.json({
    projects,
    tasks: tasks.map((t) => ({ id: t.id, label: t.title, projectId: t.project.id, projectName: t.project.name })),
  });
});
