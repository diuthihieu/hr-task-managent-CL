// Object storage for attachment bytes (Vercel Blob). PostgreSQL stores only
// metadata + the blob URL/pathname. Blobs are private by default and served
// through /api/attachments/[id]/download after an authorization check.

import { put, get, del, copy } from "@vercel/blob";
import { HttpError } from "./http-errors";
import { safeContentType } from "./content-type";

export { safeContentType };

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel function request body limit is 4.5 MB.
export const MAX_CLIENT_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_AGENT_ARTIFACT_BYTES = 20 * 1024 * 1024;

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

/** Validate metadata before issuing a short-lived direct-to-Blob upload token. */
export function assertClientUploadAllowed(name: string, contentType: string, size: number) {
  if (!storageConfigured()) throw new HttpError(503, "File storage is not configured (BLOB_READ_WRITE_TOKEN missing)");
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, "File is empty");
  if (size > MAX_CLIENT_UPLOAD_BYTES) throw new HttpError(413, `File is too large (max ${MAX_CLIENT_UPLOAD_BYTES / 1024 / 1024} MB)`);
  if (BLOCKED_EXT.test(name) || BLOCKED_TYPES.some((re) => re.test(contentType))) throw new HttpError(400, "This file type is not allowed");
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
export async function uploadAttachment(opts: { workspaceId: string; taskId?: string; wikiPageId?: string; agentSkillId?: string; file: File }) {
  const owner = opts.taskId ? `tasks/${opts.taskId}` : opts.wikiPageId ? `wiki/${opts.wikiPageId}` : `agent-skills/${opts.agentSkillId}`;
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

const AGENT_ARTIFACT_TYPES = new Set([
  "application/json; charset=utf-8",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown; charset=utf-8",
  "text/plain; charset=utf-8",
]);

/** Store a server-generated Agent artifact in the same private-by-default Blob store as attachments. */
export async function uploadAgentArtifact(opts: { workspaceId: string; runId: string; filename: string; mimeType: string; data: Buffer }) {
  if (!storageConfigured()) throw new HttpError(503, "File storage is not configured (BLOB_READ_WRITE_TOKEN missing)");
  if (!opts.data.length || opts.data.length > MAX_AGENT_ARTIFACT_BYTES) throw new HttpError(413, `Artifact is too large (max ${MAX_AGENT_ARTIFACT_BYTES / 1024 / 1024} MB)`);
  if (!AGENT_ARTIFACT_TYPES.has(opts.mimeType)) throw new HttpError(400, "Unsupported Agent artifact type");
  const pathname = `workspaces/${opts.workspaceId}/agent-runs/${opts.runId}/${safeFileName(opts.filename)}`;
  const mode = access();
  try {
    const result = await put(pathname, opts.data, { access: mode, addRandomSuffix: true, contentType: opts.mimeType });
    return { url: result.url, pathname: result.pathname, provider: providerOf(mode) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/access|public|private/i.test(message)) throw new HttpError(503, `File storage is misconfigured: the Blob store does not accept ${mode} files`);
    throw storageError(error);
  }
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

/**
 * Server-side copy of a stored file under a new task (duplicating a task must not share one blob between two
 * attachments: deleting either would break the other). Keeps the access mode the file was written with.
 */
export async function copyTaskAttachmentBlob(opts: { url: string; provider?: string | null; workspaceId: string; taskId: string; fileName: string; contentType: string }) {
  if (!storageConfigured()) throw new HttpError(503, "File storage is not configured (BLOB_READ_WRITE_TOKEN missing)");
  const pathname = `workspaces/${opts.workspaceId}/tasks/${opts.taskId}/${safeFileName(opts.fileName)}`;
  const access = accessOf(opts.provider);
  try {
    const result = await copy(opts.url, pathname, { access, addRandomSuffix: true, contentType: opts.contentType });
    return { url: result.url, pathname: result.pathname, provider: providerOf(access) };
  } catch (e) {
    throw storageError(e);
  }
}

export async function deleteAttachmentBlob(url: string) {
  if (!storageConfigured()) return;
  await del(url);
}
