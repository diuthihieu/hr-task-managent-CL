import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route } from "@/lib/authz";
import { serializeActivity } from "@/lib/activity-query";

type P = { workspaceId: string };

/** Workspace audit trail, newest first, cursor-paginated (`?before=<iso>`). Admins only. */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const url = new URL(req.url);
  const before = url.searchParams.get("before");
  const entityType = url.searchParams.get("entityType");
  const take = Math.min(Number(url.searchParams.get("limit")) || 100, 200);
  const rows = await prisma.activityLog.findMany({
    where: { workspaceId, ...(entityType ? { entityType } : {}), ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { id: true, name: true, avatarColor: true } } },
  });
  return NextResponse.json(rows.map(serializeActivity));
});
