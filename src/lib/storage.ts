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

/** Per-user upload quota across all instances (abuse / storage-cost protection). */
export async function assertUploadQuota(userId: string) {
  const { rateLimit } = await import("./rate-limit");
  if (!(await rateLimit(`upload:${userId}`, 60, 3600_000))) throw new HttpError(429, "Too many uploads - try again in an hour");
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
 * Upload with the configured access mode - never silently another one. A
 * store created public rejects private writes (and vice versa); that is a
 * configuration error to fix, not a reason to publish HR files at a public URL.
 */
export async function uploadAttachment(opts: { workspaceId: string; taskId?: string; wikiPageId?: string; file: File }) {
  const owner = opts.taskId ? `tasks/${opts.taskId}` : `wiki/${opts.wikiPageId}`;
  const pathname = `workspaces/${opts.workspaceId}/${owner}/${safeFileName(opts.file.name)}`;
  const mode = access();
  try {
    const result = await put(pathname, opts.file, { access: mode, addRandomSuffix: true, contentType: safeContentType(opts.file) });
    return { url: result.url, pathname: result.pathname, provider: providerOf(mode) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/access|public|private/i.test(msg)) {
      console.error("[storage] access mode rejected by the Blob store:", msg);
      throw new HttpError(503, `File storage is misconfigured: the Blob store does not accept ${mode} files (check BLOB_ACCESS and the store type)`);
    }
    throw storageError(e);
  }
}

/**
 * The type recorded for the blob. The browser's claim is only kept when it
 * matches the extension family; anything else is stored as a download
 * (application/octet-stream), so a renamed file can't be served as something active.
 */
const EXT_TYPES: Record<string, RegExp> = {
  pdf: /^application\/pdf$/, png: /^image\/png$/, jpg: /^image\/jpeg$/, jpeg: /^image\/jpeg$/, gif: /^image\/gif$/, webp: /^image\/webp$/,
  txt: /^text\/plain/, csv: /^text\/(csv|plain)/, md: /^text\/(markdown|plain)/, json: /^application\/json/,
  docx: /officedocument\.wordprocessingml/, xlsx: /officedocument\.spreadsheetml/, pptx: /officedocument\.presentationml/,
  doc: /msword/, xls: /ms-excel/, ppt: /ms-powerpoint/, zip: /zip/, mp4: /^video\/mp4$/, mp3: /^audio\/mpeg$/,
};
export function safeContentType(file: { name: string; type: string }) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const claimed = (file.type || "").toLowerCase();
  return EXT_TYPES[ext]?.test(claimed) ? claimed : "application/octet-stream";
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
