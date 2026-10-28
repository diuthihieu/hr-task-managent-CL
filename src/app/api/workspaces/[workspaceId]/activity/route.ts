import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hiddenProjectIds, requireUser, requireWorkspaceRole, route } from "@/lib/authz";
import { serializeActivity } from "@/lib/activity-query";
import { activityInProjects } from "@/lib/activity-hidden";

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
  const where: Prisma.ActivityLogWhereInput = { workspaceId, ...(entityType ? { entityType } : {}), ...(before ? { createdAt: { lt: new Date(before) } } : {}) };
  // Leave out what happened inside projects hidden from the caller (titles are in the summaries).
  const hidden = [...(await hiddenProjectIds(user))];
  if (hidden.length) {
    const visible = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT a.id FROM activity_logs a
      WHERE a.workspace_id = ${workspaceId}::uuid
        ${entityType ? Prisma.sql`AND a.entity_type = ${entityType}` : Prisma.empty}
        ${before ? Prisma.sql`AND a.created_at < ${new Date(before)}` : Prisma.empty}
        AND NOT ${activityInProjects(hidden)}
      ORDER BY a.created_at DESC
      LIMIT ${take}
    `);
    where.id = { in: visible.map((r) => r.id) };
  }
  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { id: true, name: true, avatarColor: true } } },
  });
  return NextResponse.json(rows.map(serializeActivity));
});
