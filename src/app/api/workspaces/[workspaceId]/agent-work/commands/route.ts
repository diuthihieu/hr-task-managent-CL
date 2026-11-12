import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson } from "@/lib/authz";
import { accessibleAgentSkillWhere } from "@/lib/agent-work/access";
import { startCommandRun } from "@/lib/agent-work/engine";
import { uuid } from "@/lib/validation";

export const maxDuration = 120;

type P = { workspaceId: string };

const schema = z
  .object({
    skillId: uuid.optional(),
    command: z.string().trim().toLowerCase().max(60).optional(),
    args: z.record(z.string(), z.unknown()).default({}),
    note: z.string().max(2000).optional(),
  })
  .refine((b) => b.skillId || b.command, "skillId or command is required");

/** Skills I can run with a slash command in this workspace (for the "/" picker). */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const skills = await prisma.agentSkill.findMany({
    where: { workspaceId, ...accessibleAgentSkillWhere(user.id), command: { not: null } },
    select: { id: true, name: true, description: true, command: true, parameters: true, outputDefinitions: true },
    orderBy: { command: "asc" },
  });
  return NextResponse.json(skills);
});

/** Run a Skill now (its command or the Run button): returns the run, its outputs and the Markdown result. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const body = schema.parse(await readJson(req));
  return NextResponse.json(await startCommandRun(user, workspaceId, body));
});
