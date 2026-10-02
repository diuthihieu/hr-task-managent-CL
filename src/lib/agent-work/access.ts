import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notFound, requireWorkspaceRole, type SessionUser } from "@/lib/authz";

export function accessibleAgentSkillWhere(userId: string): Prisma.AgentSkillWhereInput {
  return {
    deletedAt: null,
    OR: [{ ownerId: userId }, { visibility: "organization" }, { visibility: "specific_people", shares: { some: { userId } } }],
  };
}

export async function requireAgentSkill(user: SessionUser, skillId: string, ownerOnly = false) {
  const skill = await prisma.agentSkill.findFirst({
    where: { id: skillId, deletedAt: null, ...(ownerOnly ? { ownerId: user.id } : accessibleAgentSkillWhere(user.id)) },
    select: { id: true, workspaceId: true, ownerId: true, systemKey: true },
  });
  if (!skill) throw notFound("Skill");
  await requireWorkspaceRole(user, skill.workspaceId, "viewer");
  return skill;
}
