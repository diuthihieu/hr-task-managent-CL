import type { AgentApprovalKind } from "@prisma/client";

export type AgentToolRisk = "safe" | "confirmation" | "human_approval";

export interface AgentToolDefinition {
  name: string;
  label: string;
  category: "woli" | "research" | "browser" | "connector" | "database" | "file" | "artifact";
  risk: AgentToolRisk;
  approvalKind?: AgentApprovalKind;
  available: boolean;
}

export const AGENT_TOOLS: readonly AgentToolDefinition[] = [
  { name: "woli.read_task", label: "Read an accessible task", category: "woli", risk: "safe", available: true },
  { name: "woli.create_task_comment", label: "Comment the result on a task", category: "woli", risk: "confirmation", available: true },
  { name: "woli.read_wiki", label: "Read an accessible wiki page", category: "woli", risk: "safe", available: false },
  { name: "artifact.save_text", label: "Save text/Markdown output", category: "artifact", risk: "safe", available: true },
  { name: "artifact.generate", label: "Generate DOCX, XLSX, PPTX or PDF output", category: "artifact", risk: "safe", available: true },
  { name: "file.read", label: "Read a permitted Task attachment", category: "file", risk: "safe", available: true },
  { name: "research.search", label: "Search/research", category: "research", risk: "confirmation", available: false },
  { name: "browser.request", label: "Browser/API request", category: "browser", risk: "human_approval", approvalKind: "external_communication", available: false },
  { name: "connector.email_send", label: "Send email", category: "connector", risk: "human_approval", approvalKind: "external_communication", available: false },
  { name: "database.write", label: "Write to database", category: "database", risk: "human_approval", approvalKind: "database_write", available: false },
  { name: "woli.delete", label: "Delete Woli data", category: "woli", risk: "human_approval", approvalKind: "delete_data", available: false },
  { name: "woli.change_permission", label: "Change access permissions", category: "woli", risk: "human_approval", approvalKind: "change_permission", available: false },
] as const;

const TOOL_BY_NAME = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]));

export function getAgentTool(name: string) {
  return TOOL_BY_NAME.get(name) ?? null;
}

export function assertAgentToolsAllowed(allowed: readonly string[], requested: readonly string[]) {
  const allowedSet = new Set(allowed);
  for (const name of requested) {
    const tool = getAgentTool(name);
    if (!tool || !tool.available) throw new Error(`Agent tool is not available: ${name}`);
    if (!allowedSet.has(name)) throw new Error(`Skill does not allow tool: ${name}`);
  }
}

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; kind: AgentApprovalKind }> = [
  { pattern: /\b(payroll|salary|compensation|lương|bảng lương)\b/i, kind: "payroll" },
  { pattern: /\b(legal|contract|lawsuit|pháp lý|hợp đồng)\b/i, kind: "legal" },
  { pattern: /\b(termination|terminate|dismissal|sa thải|chấm dứt)\b/i, kind: "termination" },
  { pattern: /\b(send email|publish|post externally|gửi email|đăng công khai)\b/i, kind: "external_communication" },
  { pattern: /\b(delete|remove permanently|xóa|xoá)\b/i, kind: "delete_data" },
  { pattern: /\b(permission|access role|phân quyền|quyền truy cập)\b/i, kind: "change_permission" },
];

export function requiredApprovalForText(text: string): AgentApprovalKind | null {
  return SENSITIVE_PATTERNS.find(({ pattern }) => pattern.test(text))?.kind ?? null;
}

export const SIMPLE_TASK_TOOLS = ["woli.read_task", "file.read", "artifact.save_text", "artifact.generate", "woli.create_task_comment"] as const;
