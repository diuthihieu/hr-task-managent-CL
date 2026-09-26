import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfDashboard } from "@/lib/authz";
import { serializeWidget } from "@/lib/dashboard-serialize";

type P = { dashboardId: string };

const widgetSchema = z.object({
  type: z.string().min(1).max(30),
  title: z.string().max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  w: z.number().int().min(1).max(12).optional(),
  h: z.number().int().min(1).max(40).optional(),
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { dashboardId } = await params;
  await requireWorkspaceRole(user, await workspaceOfDashboard(dashboardId), "editor");
  const body = widgetSchema.parse(await readJson(req));
  const existing = await prisma.dashboardWidget.findMany({ where: { dashboardId }, select: { y: true, h: true } });
  // Stack new widgets below the tallest existing one so they never overlap.
  const maxY = existing.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  const w = await prisma.dashboardWidget.create({
    data: {
      dashboardId,
      type: body.type,
      title: body.title ?? "",
      config: (body.config ?? {}) as Prisma.InputJsonValue,
      x: 0,
      y: maxY,
      w: body.w ?? (body.type === "kpi" ? 3 : 6),
      h: body.h ?? (body.type === "kpi" ? 2 : 4),
      sortOrder: existing.length,
    },
  });
  return NextResponse.json(serializeWidget(w), { status: 201 });
});
