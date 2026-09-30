import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfWidget } from "@/lib/authz";
import { serializeWidget } from "@/lib/dashboard-serialize";
import { assertWidgetSource } from "@/lib/dashboard-data";

type P = { blockId: string };

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  type: z.string().min(1).max(30).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  x: z.number().int().min(0).max(100).optional(),
  y: z.number().int().min(0).max(10000).optional(),
  w: z.number().int().min(1).max(12).optional(),
  h: z.number().int().min(1).max(40).optional(),
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { blockId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWidget(blockId), "editor");
  const body = patchSchema.parse(await readJson(req));
  if (body.config) await assertWidgetSource(user, ctx.workspaceId, body.config);
  const w = await prisma.dashboardWidget.update({ where: { id: blockId }, data: { ...body, config: body.config as Prisma.InputJsonValue | undefined } });
  return NextResponse.json(serializeWidget(w));
});

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { blockId } = await params;
  await requireWorkspaceRole(user, await workspaceOfWidget(blockId), "editor");
  await prisma.dashboardWidget.delete({ where: { id: blockId } });
  return new NextResponse(null, { status: 204 });
});
