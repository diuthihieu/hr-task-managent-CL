import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, notFound, badRequest } from "@/lib/authz";
import { agentSkillBodySchema } from "@/lib/agent-work/skill-schema";

type P = { skillId: string };
const schema = z.object({ active: z.boolean() });
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { skillId } = await params;
  const body = schema.parse(await readJson(req));
  const skill = await prisma.agentSkill.findFirst({ where: { id: skillId, deletedAt: null, OR: [{ ownerId: user.id }, { visibility: "organization" }, { visibility: "specific_people", shares: { some: { userId: user.id } } }] }, select: { id: true, workspaceId: true } });
  if (!skill) throw notFound("Skill");
  await requireWorkspaceRole(user, skill.workspaceId, "viewer");
  await prisma.agentSkillActivation.upsert({ where: { skillId_userId: { skillId, userId: user.id } }, create: { skillId, userId: user.id, active: body.active }, update: { active: body.active } });
  return NextResponse.json({ active: body.active });
});

export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { skillId } = await params;
  const body = agentSkillBodySchema.parse(await readJson(req));
  const skill = await prisma.agentSkill.findFirst({ where: { id: skillId, ownerId: user.id, deletedAt: null }, select: { id: true, workspaceId: true, systemKey: true } });
  if (!skill) throw notFound("Skill");
  await requireWorkspaceRole(user, skill.workspaceId, "viewer");
  if (skill.systemKey) throw badRequest("Built-in Skills cannot be edited");
  if (body.visibility === "specific_people" && !body.shareWithUserIds.length) throw badRequest("Choose at least one person to share this Skill with");
  if (body.shareWithUserIds.length) {
    const count = await prisma.workspaceMember.count({ where: { workspaceId: skill.workspaceId, userId: { in: body.shareWithUserIds } } });
    if (count !== new Set(body.shareWithUserIds).size) throw badRequest("Every shared person must belong to this workspace");
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.agentSkill.update({
      where: { id: skill.id },
      data: {
        name: body.name,
        description: body.description,
        instructions: body.instructions,
        triggers: asJson(body.triggers),
        inputSchema: asJson(body.inputSchema),
        workflow: asJson(body.workflow),
        toolsAllowed: body.toolsAllowed,
        referenceFiles: asJson(body.referenceFiles),
        templates: asJson(body.templates),
        validationRules: asJson(body.validationRules),
        outputDefinitions: asJson(body.outputDefinitions),
        visibility: body.visibility,
        version: { increment: 1 },
      },
      select: { id: true, version: true },
    });
    await tx.agentSkillShare.deleteMany({ where: { skillId: skill.id } });
    if (body.visibility === "specific_people") await tx.agentSkillShare.createMany({ data: body.shareWithUserIds.map((userId) => ({ skillId: skill.id, userId })), skipDuplicates: true });
    return row;
  });
  return NextResponse.json(updated);
});
