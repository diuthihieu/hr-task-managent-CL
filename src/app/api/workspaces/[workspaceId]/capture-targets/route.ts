import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route } from "@/lib/authz";
import { PRIORITY_OPTIONS_DEFAULT } from "@/lib/field-types";
import type { CaptureTargetRow } from "@/types";

type P = { workspaceId: string };

/** Active projects a captured thought can be converted into, with the workspace's categories/statuses. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "contributor");
  const [projects, categories, statuses] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId, deletedAt: null, status: { in: ["active", "on_hold"] } }, orderBy: { sortOrder: "asc" } }),
    prisma.category.findMany({ where: { workspaceId }, orderBy: { sortOrder: "asc" } }),
    prisma.status.findMany({ where: { workspaceId }, orderBy: { sortOrder: "asc" } }),
  ]);
  const categoryOptions = categories.map((c) => ({ id: c.id, label: c.name, color: c.color }));
  const statusOptions = statuses.map((s) => ({ id: s.id, label: s.name, color: s.color }));
  const rows: CaptureTargetRow[] = projects.map((p) => ({
    projectId: p.id,
    projectName: p.name,
    categoryOptions,
    statusOptions,
    priorityOptions: PRIORITY_OPTIONS_DEFAULT,
  }));
  return NextResponse.json(rows);
});
