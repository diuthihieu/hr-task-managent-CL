import { prisma } from "@/lib/prisma";
import { notFound, requireUser, route } from "@/lib/authz";
import { requireAgentSkill } from "@/lib/agent-work/access";
import { openAttachment } from "@/lib/storage";

type P = { attachmentId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { attachmentId } = await params;
  const file = await prisma.attachment.findFirst({ where: { id: attachmentId, agentSkillId: { not: null }, deletedAt: null }, select: { agentSkillId: true, fileName: true, contentType: true, sizeBytes: true, storageProvider: true, url: true } });
  if (!file?.agentSkillId) throw notFound("File");
  await requireAgentSkill(user, file.agentSkillId, true);
  const blob = await openAttachment(file.url, file.storageProvider);
  if (!blob) throw notFound("File");
  return new Response(blob.stream, { headers: { "Content-Type": file.contentType, "Content-Length": String(file.sizeBytes), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store" } });
});
