import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson } from "@/lib/authz";
import { approveAgentRun, cancelAgentRun, executeAgentRun, getAgentRun } from "@/lib/agent-work/engine";

export const maxDuration = 120;

type P = { runId: string };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("execute"), confirmed: z.boolean() }),
  z.object({ action: z.literal("approve"), note: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal("reject"), note: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal("cancel") }),
]);

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { runId } = await params;
  return NextResponse.json(await getAgentRun(user, runId));
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { runId } = await params;
  const body = schema.parse(await readJson(req));
  if (body.action === "execute") return NextResponse.json(await executeAgentRun(user, runId, body.confirmed));
  if (body.action === "approve") return NextResponse.json(await approveAgentRun(user, runId, true, body.note));
  if (body.action === "reject") return NextResponse.json(await approveAgentRun(user, runId, false, body.note));
  return NextResponse.json(await cancelAgentRun(user, runId));
});
