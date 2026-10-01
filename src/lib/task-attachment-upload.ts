"use client";

import { upload } from "@vercel/blob/client";
import type { AttachmentRow } from "@/types";

const DIRECT_THRESHOLD = 4 * 1024 * 1024;

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return new Error(body.error || `Upload failed (${response.status})`);
}

export async function uploadTaskAttachment(taskId: string, file: File): Promise<AttachmentRow> {
  if (file.size <= DIRECT_THRESHOLD) {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: form });
    if (!response.ok) throw await responseError(response);
    return response.json() as Promise<AttachmentRow>;
  }

  const safeName = file.name.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 200) || "file";
  // Resolve an authorized workspace-scoped prefix without exposing a storage
  // token to the browser.
  const tokenPathResponse = await fetch(`/api/tasks/${taskId}/upload-path`);
  if (!tokenPathResponse.ok) throw await responseError(tokenPathResponse);
  const { pathname, access } = await tokenPathResponse.json() as { pathname: string; access: "public" | "private" };
  const blob = await upload(`${pathname}${safeName}`, file, {
    access,
    handleUploadUrl: "/api/uploads/task",
    clientPayload: JSON.stringify({ taskId, fileName: safeName, contentType: file.type || "application/octet-stream", sizeBytes: file.size }),
    contentType: file.type || "application/octet-stream",
    multipart: true,
  });
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await fetch(`/api/tasks/${taskId}/attachments`, { cache: "no-store" });
    if (response.ok) {
      const rows = await response.json() as Array<AttachmentRow & { uploadKey?: string }>;
      const match = rows.find((row) => row.uploadKey === blob.pathname);
      if (match) return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(`Upload completed but metadata is still processing (${blob.pathname})`);
}
