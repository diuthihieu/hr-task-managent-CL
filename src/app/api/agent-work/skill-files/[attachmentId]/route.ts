import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFound, requireUser, route } from "@/lib/authz";
import { requireAgentSkill } from "@/lib/agent-work/access";
import { deleteAttachmentBlob } from "@/lib/storage";
import { logActivity } from "@/lib/activity";

type P = { attachmentId: string };

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { attachmentId } = await params;
  const file = await prisma.attachment.findFirst({ where: { id: attachmentId, agentSkillId: { not: null }, deletedAt: null }, select: { id: true, agentSkillId: true, fileName: true, workspaceId: true, url: true } });
  if (!file?.agentSkillId) throw notFound("File");
  await requireAgentSkill(user, file.agentSkillId, true);
  await prisma.$transaction(async (tx) => {
    await tx.attachment.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
    await logActivity(tx, { workspaceId: file.workspaceId, actorId: user.id, entityType: "agent_skill", entityId: file.agentSkillId!, action: "updated", summary: `Removed Skill reference file "${file.fileName}"` });
  });
  await deleteAttachmentBlob(file.url).catch((error) => console.error("Agent Skill reference blob delete failed", error));
  return new NextResponse(null, { status: 204 });
});
