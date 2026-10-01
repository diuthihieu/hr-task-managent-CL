import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { forbidden, requireUser, requireWorkspaceRole, roleAtLeast, route, workspaceOfProject } from "@/lib/authz";

type P = { projectId: string };
type HistoryRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: string | null;
  changes: Prisma.JsonValue | null;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorColor: string | null;
};

/** Permission-filtered Project Version History backed by the existing append-only activity log. */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { projectHistoryMemberDays: true } });
  const privileged = roleAtLeast(ctx.role, "admin");
  const allowedDays = privileged ? 365 : workspace.projectHistoryMemberDays;
  if (!allowedDays) throw forbidden("Project Version History is not enabled for workspace members");

  const url = new URL(req.url);
  const beforeValue = url.searchParams.get("before");
  const before = beforeValue ? new Date(beforeValue) : null;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);
  const cutoff = new Date(Date.now() - allowedDays * 86_400_000);
  const beforeFilter = before && !Number.isNaN(before.getTime()) ? Prisma.sql`AND a.created_at < ${before}` : Prisma.empty;

  const rows = await prisma.$queryRaw<HistoryRow[]>(Prisma.sql`
    SELECT
      a.id,
      a.entity_type AS "entityType",
      a.entity_id AS "entityId",
      a.action,
      a.summary,
      a.changes,
      a.created_at AS "createdAt",
      u.id AS "actorId",
      u.name AS "actorName",
      u.avatar_color AS "actorColor"
    FROM activity_logs a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.workspace_id = ${ctx.workspaceId}::uuid
      AND a.created_at >= ${cutoff}
      ${beforeFilter}
      AND (
        (a.entity_type = 'project' AND a.entity_id = ${projectId}::uuid)
        OR (a.entity_type = 'task' AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = a.entity_id AND t.project_id = ${projectId}::uuid))
        OR (a.entity_type = 'comment' AND EXISTS (SELECT 1 FROM comments c JOIN tasks t ON t.id = c.task_id WHERE c.id = a.entity_id AND t.project_id = ${projectId}::uuid))
        OR (a.entity_type = 'attachment' AND EXISTS (SELECT 1 FROM attachments f JOIN tasks t ON t.id = f.task_id WHERE f.id = a.entity_id AND t.project_id = ${projectId}::uuid))
        OR (a.entity_type = 'view' AND (
          EXISTS (SELECT 1 FROM views v WHERE v.id = a.entity_id AND v.project_id = ${projectId}::uuid)
          OR a.changes #>> '{projectId,from}' = ${projectId}
          OR a.changes #>> '{projectId,to}' = ${projectId}
        ))
        OR (a.entity_type = 'custom_field' AND EXISTS (SELECT 1 FROM custom_fields f WHERE f.id = a.entity_id AND f.project_id = ${projectId}::uuid))
        OR (a.entity_type = 'category' AND EXISTS (SELECT 1 FROM categories c WHERE c.id = a.entity_id AND c.project_id = ${projectId}::uuid))
        OR (a.entity_type = 'objective' AND EXISTS (SELECT 1 FROM objectives o WHERE o.id = a.entity_id AND o.project_id = ${projectId}::uuid))
        OR (a.entity_type = 'key_result' AND EXISTS (SELECT 1 FROM key_results k JOIN objectives o ON o.id = k.objective_id WHERE k.id = a.entity_id AND o.project_id = ${projectId}::uuid))
      )
    ORDER BY a.created_at DESC
    LIMIT ${limit}
  `);

  return NextResponse.json({
    allowedDays,
    events: rows.map((row) => ({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      summary: row.summary,
      changes: row.changes,
      createdAt: row.createdAt.toISOString(),
      actor: row.actorId ? { id: row.actorId, name: row.actorName ?? "Unknown", avatarColor: row.actorColor ?? "#64748b" } : null,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
});
