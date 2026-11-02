import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireUser, requireWorkspaceRole, route, workspaceOfDashboard } from "@/lib/authz";
import { dashboardSlicerOptions, parseSlicers } from "@/lib/dashboard-data";
import type { CrossFilter } from "@/lib/dashboard-engine";

type P = { dashboardId: string };

const bodySchema = z.object({
  fieldName: z.string().trim().min(1).max(200),
  slicers: z.array(z.unknown()).max(20).optional(),
  crossFilter: z.object({ fieldName: z.string().max(200), label: z.string().max(500) }).nullable().optional(),
});

/** D3: a slicer's values (with counts) or date range, linked to the other slicers and a chart click, for this viewer. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { dashboardId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfDashboard(dashboardId), "viewer");
  const body = bodySchema.parse(await readJson(req));
  return NextResponse.json(await dashboardSlicerOptions(user, ctx.workspaceId, dashboardId, body.fieldName, parseSlicers(body.slicers), (body.crossFilter as CrossFilter | null | undefined) ?? null));
});
