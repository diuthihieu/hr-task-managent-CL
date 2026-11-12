import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { runWorkflowNow } from "@/lib/agent-work/workflows";

export const maxDuration = 120;

/** Run now: the result goes to my Woli AI inbox like a scheduled run; the schedule is untouched. */
export const POST = route<{ workflowId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  return NextResponse.json(await runWorkflowNow(user, uuid.parse((await params).workflowId)));
});
