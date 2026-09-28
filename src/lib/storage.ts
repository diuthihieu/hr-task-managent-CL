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

/** Provider marker stored on each attachment row, so reads use the access mode the blob was written with. */
export type StorageProvider = "vercel_blob" | "vercel_blob_public";
const providerOf = (a: "public" | "private"): StorageProvider => (a === "public" ? "vercel_blob_public" : "vercel_blob");
const accessOf = (p: string | null | undefined): "public" | "private" => (p === "vercel_blob_public" ? "public" : "private");

/**
 * Upload with the configured access mode. A Blob store is created either
 * public or private, and writing with the wrong mode is rejected, so when the
 * store rejects the configured mode we retry once with the other one instead
 * of failing every upload on a misconfigured BLOB_ACCESS.
 */
export async function uploadAttachment(opts: { workspaceId: string; taskId?: string; wikiPageId?: string; file: File }) {
  const owner = opts.taskId ? `tasks/${opts.taskId}` : `wiki/${opts.wikiPageId}`;
  const pathname = `workspaces/${opts.workspaceId}/${owner}/${safeFileName(opts.file.name)}`;
  const write = (mode: "public" | "private") =>
    put(pathname, opts.file, { access: mode, addRandomSuffix: true, contentType: opts.file.type || "application/octet-stream" });
  const preferred = access();
  let mode = preferred;
  let result;
  try {
    result = await write(preferred);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/access|public|private/i.test(msg)) throw storageError(e);
    mode = preferred === "private" ? "public" : "private";
    try {
      result = await write(mode);
    } catch (e2) {
      throw storageError(e2);
    }
  }
  return { url: result.url, pathname: result.pathname, provider: providerOf(mode) };
}

function storageError(e: unknown) {
  console.error("[storage] upload failed:", e);
  const msg = e instanceof Error ? e.message : "";
  if (/token|unauthori[sz]ed|forbidden/i.test(msg)) return new HttpError(503, "File storage rejected the upload: check BLOB_READ_WRITE_TOKEN on the server");
  return new HttpError(502, "File storage is unavailable, please try again");
}

export async function openAttachment(url: string, provider?: string | null) {
  return get(url, { access: accessOf(provider) });
}

export async function deleteAttachmentBlob(url: string) {
  if (!storageConfigured()) return;
  await del(url);
}
