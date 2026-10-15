import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfDashboard, workspaceOfProject, badRequest } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { REPORT_CHARTS_MAX, REPORT_CONTENT_MAX, REPORT_FILENAME_MAX, REPORT_PROMPT_MAX, REPORT_SVG_MAX, cleanFileName } from "@/lib/ai/report-limits";

type P = { workspaceId: string };

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(REPORT_FILENAME_MAX),
  prompt: z.string().max(REPORT_PROMPT_MAX).default(""),
  content: z.string().min(1).max(REPORT_CONTENT_MAX),
  charts: z.array(z.object({ id: z.string().min(1).max(64), title: z.string().max(200), svg: z.string().max(REPORT_SVG_MAX) })).max(REPORT_CHARTS_MAX).default([]),
  projectId: uuid.nullish(),
  dashboardId: uuid.nullish(),
});

const listSelect = { id: true, title: true, fileName: true, prompt: true, createdAt: true, projectId: true, dashboardId: true, project: { select: { name: true } }, dashboard: { select: { name: true } } } as const;

/** My report library in this workspace (saved AI reports are private to their creator). */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const dashboardId = url.searchParams.get("dashboardId");
  const rows = await prisma.savedReport.findMany({
    where: { workspaceId, userId: user.id, ...(projectId ? { projectId } : {}), ...(dashboardId ? { dashboardId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: listSelect,
  });
  return NextResponse.json(rows.map((r) => ({ ...r, source: r.project?.name ?? r.dashboard?.name ?? null, project: undefined, dashboard: undefined })));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const body = schema.parse(await readJson(req));
  // The source must be in this workspace and visible to the user.
  if (body.projectId && (await requireWorkspaceRole(user, await workspaceOfProject(body.projectId), "viewer")).workspaceId !== workspaceId) throw badRequest("Project is in another workspace");
  if (body.dashboardId && (await requireWorkspaceRole(user, await workspaceOfDashboard(body.dashboardId), "viewer")).workspaceId !== workspaceId) throw badRequest("Dashboard is in another workspace");
  const count = await prisma.savedReport.count({ where: { workspaceId, userId: user.id } });
  if (count >= 500) throw badRequest("Your report library is full (500). Delete old reports first.");
  const row = await prisma.savedReport.create({
    data: {
      workspaceId,
      userId: user.id,
      projectId: body.projectId ?? null,
      dashboardId: body.dashboardId ?? null,
      title: body.title,
      fileName: cleanFileName(body.fileName) || "report",
      prompt: body.prompt,
      content: body.content,
      charts: body.charts,
    },
    select: listSelect,
  });
  return NextResponse.json({ ...row, source: row.project?.name ?? row.dashboard?.name ?? null, project: undefined, dashboard: undefined }, { status: 201 });
});
