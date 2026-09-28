import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfTask } from "@/lib/authz";

type P = { taskId: string };

/** People who can be @mentioned on this task: members who can see its project. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: ctx.workspaceId, user: { isActive: true, deletedAt: null, hiddenProjects: { none: { projectId: ctx.projectId } } } },
    select: { user: { select: { id: true, name: true, email: true, avatarColor: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(members.map((m) => m.user));
});
