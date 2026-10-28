import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, notFound } from "@/lib/authz";
import { assertProjectCap } from "@/lib/project-permissions";
import { loadProjectGrid, loadProjectGridPage } from "@/server/tasks/read";
import { createTaskInProject } from "@/server/tasks/mutations";

type P = { projectId: string };

export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  const url = new URL(req.url);
  if (url.searchParams.has("limit") || url.searchParams.has("cursor") || url.searchParams.has("search")) {
    const page = await loadProjectGridPage(projectId, {
      limit: Number(url.searchParams.get("limit") || 100),
      cursor: url.searchParams.get("cursor") || undefined,
      search: url.searchParams.get("search") || undefined,
    });
    if (!page) throw notFound("Project");
    return NextResponse.json(page);
  }
  const grid = await loadProjectGrid(projectId);
  if (!grid) throw notFound("Project");
  return NextResponse.json(grid.records);
});

const createSchema = z.object({ data: z.record(z.string(), z.unknown()).default({}) });

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "contributor");
  await assertProjectCap(ctx, projectId, "task.create");
  const { data } = createSchema.parse(await readJson(req));
  const record = await createTaskInProject(ctx, projectId, data);
  return NextResponse.json(record, { status: 201 });
});
