import { NextResponse } from "next/server";
import { requireUser, route, readJson } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { deleteWorkflow, updateWorkflow, workflowBody } from "@/lib/agent-work/workflows";

type P = { workflowId: string };

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const id = uuid.parse((await params).workflowId);
  return NextResponse.json(await updateWorkflow(user, id, workflowBody.partial().parse(await readJson(req))));
});

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  await deleteWorkflow(user, uuid.parse((await params).workflowId));
  return NextResponse.json({ ok: true });
});
