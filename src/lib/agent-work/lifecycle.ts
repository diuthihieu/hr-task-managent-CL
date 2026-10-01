import type { AgentRunStatus } from "@prisma/client";

const TRANSITIONS: Record<AgentRunStatus, readonly AgentRunStatus[]> = {
  suggested: ["confirming", "cancelled"],
  confirming: ["planning", "cancelled", "failed"],
  planning: ["running", "waiting_approval", "cancelled", "failed"],
  running: ["waiting_approval", "completed", "failed", "cancelled"],
  waiting_approval: ["planning", "running", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionAgentRun(from: AgentRunStatus, to: AgentRunStatus) {
  return TRANSITIONS[from].includes(to);
}

export function assertAgentRunTransition(from: AgentRunStatus, to: AgentRunStatus) {
  if (!canTransitionAgentRun(from, to)) throw new Error(`Invalid Agent Run transition: ${from} -> ${to}`);
}

export const ACTIVE_AGENT_RUN_STATUSES: AgentRunStatus[] = ["confirming", "planning", "running", "waiting_approval"];

