import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest, visibleProjectWhere } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { dateOnlyToDate, projectInputSchema } from "@/lib/validation";
import { serializeProject } from "@/lib/serializers";
import { makeT, normalizeLocale } from "@/lib/i18n/core";

type P = { workspaceId: string };

const CATEGORY_COLORS = ["#6366f1", "#0ea5e9", "#22c55e", "#f97316", "#ec4899", "#eab308", "#14b8a6", "#8b5cf6"];

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const projects = await prisma.project.findMany({ where: { workspaceId, deletedAt: null, ...visibleProjectWhere(user) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json(projects.map(serializeProject));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "editor");
  const body = projectInputSchema.parse(await readJson(req));
  const t = makeT(normalizeLocale(user.locale));
  if (body.ownerId && !(await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: body.ownerId } }))) throw badRequest("Owner must be a workspace member");
  const last = await prisma.project.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        workspaceId,
        name: body.name,
        description: body.description ?? null,
        color: body.color,
        icon: body.icon,
        status: body.status,
        ownerId: body.ownerId ?? user.id,
        startDate: dateOnlyToDate(body.startDate),
        endDate: dateOnlyToDate(body.endDate),
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: user.id,
        updatedById: user.id,
        // A new project starts with one blank task table; any other views are added by the user.
        views: {
          create: [{ name: t("view.default.all"), type: "grid", isDefault: true, sortOrder: 0, createdById: user.id }],
        },
      },
    });
    const names = new Set<string>();
    const categories = (body.categories ?? []).filter((c) => !names.has(c.name.toLowerCase()) && names.add(c.name.toLowerCase()));
    if (categories.length) {
      await tx.category.createMany({
        data: categories.map((c, i) => ({ workspaceId, projectId: p.id, name: c.name, color: c.color ?? CATEGORY_COLORS[i % CATEGORY_COLORS.length], sortOrder: i, createdById: user.id, updatedById: user.id })),
      });
    }
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "project", entityId: p.id, action: "created", summary: `Created project "${p.name}"` });
    return p;
  });
  return NextResponse.json(serializeProject(project), { status: 201 });
});
