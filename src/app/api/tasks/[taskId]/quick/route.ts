import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson } from "@/lib/authz";
import { quickTaskAction } from "@/lib/task-quick";
import { loadTaskRecord } from "@/lib/task-grid";
import { doneMissing } from "@/lib/done-check";

type P = { taskId: string };
const schema = z.object({ action: z.enum(["complete", "start", "plan", "reopen"]) });

/** One-click Complete / Start / Plan (start today) / Reopen. Returns the updated record. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const { action } = schema.parse(await readJson(req));
  await quickTaskAction(user, taskId, action);
  const record = await loadTaskRecord(taskId);
  return NextResponse.json(action === "complete" && record ? { ...record, doneMissing: doneMissing(record.data) } : record);
});
