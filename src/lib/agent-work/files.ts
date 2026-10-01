import "server-only";

import { extractBufferText, isExtractable, MAX_DOC_BYTES } from "@/lib/ai/extract";
import { openAttachment } from "@/lib/storage";

export interface AgentReadableAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageProvider: string | null;
  url: string;
}

export interface AgentFileContext {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  text?: string;
  skippedReason?: string;
}

const MAX_AGENT_FILES = 5;
const MAX_AGENT_FILE_CONTEXT_CHARS = 80_000;

/** Read only attachments already authorized through their parent Task query. Content is never written to logs. */
export async function readAgentTaskFiles(attachments: readonly AgentReadableAttachment[], workspaceId: string): Promise<AgentFileContext[]> {
  const results: AgentFileContext[] = [];
  let remainingChars = MAX_AGENT_FILE_CONTEXT_CHARS;
  for (const file of attachments.slice(0, MAX_AGENT_FILES)) {
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
      results.push({ ...metadata, skippedReason: "Agent file context limit reached" });
      continue;
    }
    try {
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
      const text = (await extractBufferText(file.fileName, buffer, workspaceId)).slice(0, remainingChars);
      remainingChars -= text.length;
      results.push({ ...metadata, text });
    } catch (error) {
      console.warn("[agent-work] file extraction failed", file.id, error instanceof Error ? error.message : error);
      results.push({ ...metadata, skippedReason: "File could not be read" });
    }
  }
  return results;
}
