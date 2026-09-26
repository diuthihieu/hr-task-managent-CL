// Object storage for attachment bytes (Vercel Blob). PostgreSQL stores only
// metadata + the blob URL/pathname. Blobs are private by default and served
// through /api/attachments/[id]/download after an authorization check.

import { put, get, del } from "@vercel/blob";
import { HttpError } from "./http-errors";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel function request body limit is 4.5 MB.

// Types a browser could execute or render as active content from our origin.
const BLOCKED_TYPES = [/^text\/html/i, /^image\/svg\+xml/i, /javascript/i, /^application\/x-msdownload/i, /^application\/xhtml/i];
const BLOCKED_EXT = /\.(html?|svg|js|mjs|exe|bat|cmd|sh|ps1|msi)$/i;

function access(): "public" | "private" {
  return process.env.BLOB_ACCESS === "public" ? "public" : "private";
}

export function storageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function assertUploadAllowed(file: File) {
  if (!storageConfigured()) throw new HttpError(503, "File storage is not configured (BLOB_READ_WRITE_TOKEN missing)");
  if (file.size === 0) throw new HttpError(400, "File is empty");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, `File is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
  if (BLOCKED_EXT.test(file.name) || BLOCKED_TYPES.some((re) => re.test(file.type))) throw new HttpError(400, "This file type is not allowed");
}

export function safeFileName(name: string) {
  const cleaned = name.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim();
  return (cleaned || "file").slice(0, 200);
}

export async function uploadAttachment(opts: { workspaceId: string; taskId: string; file: File }) {
  const pathname = `workspaces/${opts.workspaceId}/tasks/${opts.taskId}/${safeFileName(opts.file.name)}`;
  const result = await put(pathname, opts.file, {
    access: access(),
    addRandomSuffix: true,
    contentType: opts.file.type || "application/octet-stream",
  });
  return { url: result.url, pathname: result.pathname };
}

export async function openAttachment(url: string) {
  return get(url, { access: access() });
}

export async function deleteAttachmentBlob(url: string) {
  if (!storageConfigured()) return;
  await del(url);
}
