import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, notFound } from "@/lib/authz";
import { openAttachment } from "@/lib/storage";

type P = { outputId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { outputId } = await params;
  const output = await prisma.agentOutput.findFirst({ where: { id: outputId, createdById: user.id, deletedAt: null } });
  if (!output) throw notFound("Output");
  await requireWorkspaceRole(user, { workspaceId: output.workspaceId, projectId: output.projectId }, "viewer");
  const headers = new Headers({ "Content-Type": output.mimeType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(output.filename)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (output.contentText !== null) return new Response(output.contentText, { headers });
  if (!output.url) throw notFound("Output file");
  const blob = await openAttachment(output.url, output.storageProvider);
  if (!blob) throw notFound("Output file");
  return new Response(blob.stream, { headers });
});
