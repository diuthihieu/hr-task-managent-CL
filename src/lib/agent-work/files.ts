import { readTaskFiles, type ReadableTaskAttachment, type TaskFileContext } from "@/lib/ai/task-files";

export type AgentReadableAttachment = ReadableTaskAttachment;
export type AgentFileContext = TaskFileContext;

/** Agent Work keeps its existing limits while sharing the same permission-safe file reader as Project AI. */
export function readAgentTaskFiles(attachments: readonly AgentReadableAttachment[], workspaceId: string): Promise<AgentFileContext[]> {
  return readTaskFiles(attachments, workspaceId, { maxFiles: 5, maxChars: 80_000, logLabel: "agent-work" });
}
