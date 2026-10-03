import "server-only";

import { extractBufferText, isExtractable, MAX_DOC_BYTES } from "./extract";
import { openAttachment } from "../storage";

export interface ReadableTaskAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageProvider: string | null;
  url: string;
  extractedText?: string | null;
}

export interface TaskFileContext {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  text?: string;
  skippedReason?: string;
}

export interface TaskFileReadOptions {
  maxFiles?: number;
  maxChars?: number;
  maxCharsPerFile?: number;
  /** Bound expensive legacy-file reads; already extracted files do not count. */
  maxUncachedFiles?: number;
  onExtracted?: (file: ReadableTaskAttachment, text: string) => Promise<void>;
  logLabel?: string;
}

/** Reads only files already authorized through the caller's parent Task query. */
export async function readTaskFiles(attachments: readonly ReadableTaskAttachment[], workspaceId: string, options: TaskFileReadOptions = {}): Promise<TaskFileContext[]> {
  const results: TaskFileContext[] = [];
  const maxFiles = options.maxFiles ?? 5;
  let remainingChars = options.maxChars ?? 80_000;
  let uncachedFiles = 0;
  for (const file of attachments.slice(0, maxFiles)) {
    const metadata = { id: file.id, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.sizeBytes };
    if (!isExtractable(file.fileName)) {
      results.push({ ...metadata, skippedReason: "Unsupported file type" });
      continue;
    }
    if (file.sizeBytes <= 0 || file.sizeBytes > MAX_DOC_BYTES) {
      results.push({ ...metadata, skippedReason: `File exceeds the ${MAX_DOC_BYTES / 1024 / 1024} MB extraction limit` });
      continue;
    }
    if (remainingChars <= 0) {
      results.push({ ...metadata, skippedReason: "File context limit reached" });
      continue;
    }
    try {
      let text = file.extractedText?.trim() ?? "";
      if (!text) {
        if (uncachedFiles >= (options.maxUncachedFiles ?? maxFiles)) {
          results.push({ ...metadata, skippedReason: "File contents are waiting to be indexed" });
          continue;
        }
        uncachedFiles++;
        const blob = await openAttachment(file.url, file.storageProvider);
        if (!blob) {
          results.push({ ...metadata, skippedReason: "Stored file was not found" });
          continue;
        }
        const buffer = Buffer.from(await new Response(blob.stream).arrayBuffer());
        if (buffer.length > MAX_DOC_BYTES) {
          results.push({ ...metadata, skippedReason: "Stored file exceeds the extraction limit" });
          continue;
        }
        text = await extractBufferText(file.fileName, buffer, workspaceId);
        if (options.onExtracted) {
          await options.onExtracted(file, text).catch((error) =>
            console.warn(`[${options.logLabel ?? "ai-files"}] could not cache extracted text`, file.id, error instanceof Error ? error.message : error)
          );
        }
      }
      const excerpt = text.slice(0, Math.min(remainingChars, options.maxCharsPerFile ?? remainingChars));
      remainingChars -= excerpt.length;
      results.push({ ...metadata, text: excerpt });
    } catch (error) {
      console.warn(`[${options.logLabel ?? "ai-files"}] file extraction failed`, file.id, error instanceof Error ? error.message : error);
      results.push({ ...metadata, skippedReason: "File could not be read" });
    }
  }
  return results;
}
