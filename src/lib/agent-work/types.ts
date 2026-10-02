export type AgentRunStatusValue = "suggested" | "confirming" | "planning" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

export interface AgentSuggestionDto {
  id: string;
  title: string;
  reason: string;
  proposedGoal: string;
  impact: string;
  confidence: number;
  status: string;
  task: { id: string; title: string; project: { id: string; name: string } };
  skill: { id: string; name: string };
  run: { id: string; status: AgentRunStatusValue; goal: string; plan: unknown };
  createdAt: string;
}

export interface AgentRunDto {
  id: string;
  status: AgentRunStatusValue;
  originType: string;
  goal: string;
  plan: unknown;
  outputSummary: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  task: { id: string; title: string } | null;
  project: { id: string; name: string } | null;
  skill: { id: string; name: string; version: number };
  outputs: AgentOutputDto[];
  approvals: Array<{ id: string; kind: string; status: string; reason: string }>;
}

export interface AgentSkillDto {
  id: string;
  name: string;
  description: string | null;
  version: number;
  visibility: string;
  systemKey: string | null;
  active: boolean;
  ownedByMe: boolean;
  toolsAllowed: string[];
  instructions: string;
  triggers: unknown;
  inputSchema: unknown;
  workflow: unknown;
  referenceFiles: unknown;
  referenceAttachments: Array<{ id: string; fileName: string; contentType: string; sizeBytes: number; createdAt: string; downloadUrl: string }>;
  templates: unknown;
  validationRules: unknown;
  outputDefinitions: Array<{ format: "markdown" | "text" | "json" | "docx" | "xlsx" | "pptx" | "pdf"; name: string }>;
  shareWithUserIds: string[];
  owner: { id: string; name: string } | null;
}

export interface AgentOutputDto {
  id: string;
  filename: string;
  type: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  task: { id: string; title: string } | null;
  project: { id: string; name: string } | null;
  skill: { id: string; name: string };
  runId: string;
}

export interface AgentSettingsDto {
  proactiveEnabled: boolean;
  suggestionMode: "silent" | "smart" | "proactive";
  minimumConfidence: number;
  scanScope: { assignedToMe?: boolean; createdByMe?: boolean; includeAllVisible?: boolean; projectIds?: string[] };
  requireConfirmation: boolean;
  automaticExecution: boolean;
}

export interface AgentWorkSnapshot {
  configured: boolean;
  settings: AgentSettingsDto;
  suggestions: AgentSuggestionDto[];
  activeRuns: AgentRunDto[];
  recentRuns: AgentRunDto[];
  skills: AgentSkillDto[];
  outputs: AgentOutputDto[];
  history: Array<{ id: string; title: string; kind: string; originType: string | null; originId: string | null; updatedAt: string; task: { id: string; title: string } | null; skill: { id: string; name: string } | null; agentRun: { id: string; status: AgentRunStatusValue } | null }>;
  members: Array<{ id: string; name: string }>;
  tools: Array<{ name: string; label: string; category: string; risk: string }>;
}
