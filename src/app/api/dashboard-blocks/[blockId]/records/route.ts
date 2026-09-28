import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireUser, requireWorkspaceRole, route, workspaceOfWidget } from "@/lib/authz";
import { recordsInSegment, summarizeSegmentTasks, type CrossFilter } from "@/lib/dashboard-engine";
import { loadBlockData } from "@/lib/dashboard-data";

type P = { blockId: string };

const LIMIT = 200;
const bodySchema = z.object({
  segment: z.object({ key: z.string().max(500), label: z.string().max(500), seriesKey: z.string().max(500).optional(), seriesLabel: z.string().max(500).optional() }),
  slicers: z.array(z.any()).max(50).optional(),
  crossFilter: z.any().optional(),
});

/** Drill-down: the tasks behind one clicked chart segment, under the same filters as the widget. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { blockId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWidget(blockId), "viewer");
  const body = bodySchema.parse(await readJson(req));
  const data = await loadBlockData(user, ctx.workspaceId, blockId, { slicers: body.slicers as CrossFilter[] | undefined, crossFilter: body.crossFilter as CrossFilter | undefined });
  if ("error" in data) return NextResponse.json({ error: data.error, tasks: [], total: 0 });
  const matched = recordsInSegment(data.records, data.fields, data.config, body.segment, user.id);
  return NextResponse.json({ tasks: summarizeSegmentTasks(matched.slice(0, LIMIT), data.fields, data.members), total: matched.length });
});
