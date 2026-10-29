import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { head } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, assertCanEditTask, route, workspaceOfTask, badRequest } from "@/lib/authz";
import { assertClientUploadAllowed, assertUploadQuota, safeFileName } from "@/lib/storage";
import { logActivity } from "@/lib/activity";
import { notifyTaskDetail } from "@/lib/notifications";
import { readTaskFiles } from "@/lib/ai/task-files";
import { attachmentDataFromUpload, clientTokenOptions } from "@/lib/upload-meta";
import { setAiContextUser } from "@/lib/ai/usage";

export const maxDuration = 120;

interface ClientPayload {
  taskId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

interface TokenPayload extends ClientPayload {
  workspaceId: string;
  uploadedById: string;
}

function parsePayload(raw: string | null): ClientPayload {
  let value: unknown;
  try { value = JSON.parse(raw ?? ""); } catch { throw badRequest("Invalid upload metadata"); }
  if (!value || typeof value !== "object") throw badRequest("Invalid upload metadata");
  const input = value as Partial<ClientPayload>;
  if (!input.taskId || !input.fileName || !input.contentType || typeof input.sizeBytes !== "number") throw badRequest("Incomplete upload metadata");
  return { taskId: input.taskId, fileName: safeFileName(input.fileName), contentType: input.contentType.slice(0, 200), sizeBytes: input.sizeBytes };
}

export const POST = route(async (req) => {
  const body = await req.json().catch(() => null) as HandleUploadBody | null;
  if (!body) throw badRequest("Invalid upload request");
  const response = await handleUpload({
    request: req,
    body,
    onBeforeGenerateToken: async (pathname, rawPayload) => {
      const user = await requireUser();
      const payload = parsePayload(rawPayload);
      const ctx = await requireWorkspaceRole(user, await workspaceOfTask(payload.taskId), "contributor");
      await assertCanEditTask(ctx, payload.taskId);
      await assertUploadQuota(user.id);
      assertClientUploadAllowed(payload.fileName, payload.contentType, payload.sizeBytes);
      const prefix = `workspaces/${ctx.workspaceId}/tasks/${payload.taskId}/`;
      if (!pathname.startsWith(prefix) || pathname !== `${prefix}${payload.fileName}`) throw badRequest("Invalid upload pathname");
      const tokenPayload: TokenPayload = { ...payload, workspaceId: ctx.workspaceId, uploadedById: user.id };
      // Blob only accepts the type checked against the extension (and serves the blob with it).
      return {
        ...clientTokenOptions(payload),
        addRandomSuffix: true,
        tokenPayload: JSON.stringify(tokenPayload),
      };
    },
    onUploadCompleted: async ({ blob, tokenPayload }) => {
      if (!tokenPayload) throw badRequest("Missing upload metadata");
      const payload = JSON.parse(tokenPayload) as TokenPayload;
      // Vercel Blob calls this without a session: the signed payload names the uploader, so their AI cap applies to the text extraction.
      setAiContextUser(payload.uploadedById);
      const prefix = `workspaces/${payload.workspaceId}/tasks/${payload.taskId}/`;
      if (!blob.pathname.startsWith(prefix)) throw badRequest("Upload path does not match task");
      const existing = await prisma.attachment.findUnique({ where: { storageKey: blob.pathname }, select: { id: true } });
      if (existing) return;
      // Recorded with the checked type and the stored blob's real size, not what the browser declared.
      const data = attachmentDataFromUpload(payload, blob, await head(blob.url), process.env.BLOB_ACCESS === "public" ? "vercel_blob_public" : "vercel_blob");
      const extractedText = data.sizeBytes <= 4 * 1024 * 1024
        ? (await readTaskFiles(
            [{ id: blob.pathname, fileName: data.fileName, contentType: data.contentType, sizeBytes: data.sizeBytes, storageProvider: data.storageProvider, url: blob.url }],
            payload.workspaceId,
            { maxFiles: 1, maxChars: 300_000, logLabel: "task-upload" }
          ))[0]?.text ?? null
        : null;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.attachment.create({ data: { ...data, extractedText } });
          await logActivity(tx, { workspaceId: payload.workspaceId, actorId: payload.uploadedById, entityType: "task", entityId: payload.taskId, action: "updated", summary: `Attached "${payload.fileName}"` });
          await notifyTaskDetail(tx, payload.taskId, payload.uploadedById, "attachments");
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
        throw error;
      }
    },
  });
  return NextResponse.json(response);
});
