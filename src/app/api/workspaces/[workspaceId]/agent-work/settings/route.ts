import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest } from "@/lib/authz";
import { getAgentSettings } from "@/lib/agent-work/engine";
import { uuid } from "@/lib/validation";

type P = { workspaceId: string };
const schema = z.object({
  proactiveEnabled: z.boolean().optional(),
  suggestionMode: z.enum(["silent", "smart", "proactive"]).optional(),
  minimumConfidence: z.number().min(0.75).max(1).optional(),
  scanScope: z.object({ assignedToMe: z.boolean(), createdByMe: z.boolean(), includeAllVisible: z.boolean(), projectIds: z.array(uuid).max(100) }).optional(),
  requireConfirmation: z.boolean().optional(),
  automaticExecution: z.boolean().optional(),
});

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  return NextResponse.json(await getAgentSettings(workspaceId, user.id));
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const body = schema.parse(await readJson(req));
  if (body.automaticExecution) throw badRequest("Automatic execution is not available in this safety-first phase");
  await getAgentSettings(workspaceId, user.id);
  await prisma.agentSettings.update({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    data: {
      proactiveEnabled: body.proactiveEnabled,
      suggestionMode: body.suggestionMode,
      minimumConfidence: body.minimumConfidence,
      scanScope: body.scanScope,
      requireConfirmation: body.requireConfirmation,
      automaticExecution: false,
    },
  });
  return NextResponse.json(await getAgentSettings(workspaceId, user.id));
});

