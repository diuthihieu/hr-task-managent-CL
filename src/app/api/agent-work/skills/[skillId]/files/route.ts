import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { badRequest, requireUser, route } from "@/lib/authz";
import { requireAgentSkill } from "@/lib/agent-work/access";
import { extractDocText, SUPPORTED_DOC_HINT } from "@/lib/ai/extract";
import { assertUploadAllowed, assertUploadQuota, deleteAttachmentBlob, safeContentType, safeFileName, uploadAttachment } from "@/lib/storage";
import { logActivity } from "@/lib/activity";

type P = { skillId: string };
export const maxDuration = 120;

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { skillId } = await params;
  await requireAgentSkill(user, skillId, true);
  const files = await prisma.attachment.findMany({ where: { agentSkillId: skillId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true } });
  return NextResponse.json(files.map((file) => ({ ...file, createdAt: file.createdAt.toISOString(), downloadUrl: `/api/agent-work/skill-files/${file.id}/download` })));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { skillId } = await params;
  const skill = await requireAgentSkill(user, skillId, true);
  if (skill.systemKey) throw badRequest("Built-in Skills must be copied before adding reference files");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Send the file as multipart form field `file`");
  assertUploadAllowed(file);
  await assertUploadQuota(user.id);
  const text = await extractDocText(file, skill.workspaceId).catch((error) => {
    if (error instanceof Error) throw error;
    throw badRequest(`This file could not be read. Supported: ${SUPPORTED_DOC_HINT}`);
  });
  const blob = await uploadAttachment({ workspaceId: skill.workspaceId, agentSkillId: skill.id, file });
  try {
    const created = await prisma.$transaction(async (tx) => {
      const attachment = await tx.attachment.create({
        data: { workspaceId: skill.workspaceId, agentSkillId: skill.id, fileName: safeFileName(file.name), contentType: safeContentType(file), sizeBytes: file.size, storageProvider: blob.provider, storageKey: blob.pathname, url: blob.url, uploadedById: user.id, extractedText: text },
        select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
      });
      await logActivity(tx, { workspaceId: skill.workspaceId, actorId: user.id, entityType: "agent_skill", entityId: skill.id, action: "updated", summary: `Added Skill reference file "${attachment.fileName}"` });
      return attachment;
    });
    return NextResponse.json({ ...created, createdAt: created.createdAt.toISOString(), downloadUrl: `/api/agent-work/skill-files/${created.id}/download` }, { status: 201 });
  } catch (error) {
    await deleteAttachmentBlob(blob.url).catch(() => {});
    throw error;
  }
});
