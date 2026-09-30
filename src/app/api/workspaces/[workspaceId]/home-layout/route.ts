import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson } from "@/lib/authz";
import { normalizeWidgets, widgetsSchema, PRESETS } from "@/lib/home-widgets";
import { parseWidgets, asJson } from "@/lib/home-templates";

type P = { workspaceId: string };

/** The caller's Home layout (the default "command center" until they customize it). */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const row = await prisma.homeLayout.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
  return NextResponse.json({ widgets: row ? parseWidgets(row.widgets) : PRESETS.command, custom: !!row });
});

const schema = z.object({ widgets: widgetsSchema, templateId: z.string().uuid().optional() });

/** Save the caller's layout (only theirs - a Home is personal). */
export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const body = schema.parse(await readJson(req));
  const widgets = normalizeWidgets(body.widgets);
  await prisma.homeLayout.upsert({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    create: { workspaceId, userId: user.id, widgets: asJson(widgets) },
    update: { widgets: asJson(widgets) },
  });
  // Count template use (only templates the caller can see).
  if (body.templateId)
    await prisma.homeTemplate.updateMany({ where: { id: body.templateId, workspaceId, OR: [{ ownerId: user.id }, { visibility: "workspace" }, { visibility: "shared", shares: { some: { userId: user.id } } }] }, data: { useCount: { increment: 1 } } });
  return NextResponse.json({ widgets, custom: true });
});

/** Back to the default Home. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  await prisma.homeLayout.deleteMany({ where: { workspaceId, userId: user.id } });
  return NextResponse.json({ widgets: PRESETS.command, custom: false });
});
