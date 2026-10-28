// Direct (browser -> Blob) uploads of large task files: what the upload token
// allows and what gets recorded once the blob exists. Never the browser's
// claims as such: the type is checked against the extension and the size is
// the stored blob's real size. Pure so it can be unit tested (no Blob in tests).
import { safeContentType } from "./content-type";

export interface DirectUploadPayload {
  taskId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  workspaceId: string;
  uploadedById: string;
}

export function clientTokenOptions(p: Pick<DirectUploadPayload, "fileName" | "contentType" | "sizeBytes">) {
  return { allowedContentTypes: [safeContentType({ name: p.fileName, type: p.contentType })], maximumSizeInBytes: p.sizeBytes };
}

export function attachmentDataFromUpload(p: DirectUploadPayload, blob: { pathname: string; url: string }, stored: { size: number }, storageProvider: string) {
  return {
    workspaceId: p.workspaceId,
    taskId: p.taskId,
    fileName: p.fileName,
    contentType: safeContentType({ name: p.fileName, type: p.contentType }),
    sizeBytes: stored.size,
    storageProvider,
    storageKey: blob.pathname,
    url: blob.url,
    uploadedById: p.uploadedById,
  };
}
