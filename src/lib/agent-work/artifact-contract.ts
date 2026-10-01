export const AGENT_ARTIFACT_FORMATS = ["markdown", "text", "json", "docx", "xlsx", "pptx", "pdf"] as const;
export type AgentArtifactFormat = (typeof AGENT_ARTIFACT_FORMATS)[number];

export interface AgentOutputDefinition {
  format: AgentArtifactFormat;
  name: string;
}

const MAX_ARTIFACTS_PER_RUN = 5;

function artifactFormat(value: unknown): AgentArtifactFormat | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (AGENT_ARTIFACT_FORMATS as readonly string[]).includes(normalized) ? normalized as AgentArtifactFormat : null;
}

export function normalizeOutputDefinitions(value: unknown): AgentOutputDefinition[] {
  if (!Array.isArray(value)) return [{ format: "markdown", name: "Agent result" }];
  const definitions: AgentOutputDefinition[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const format = artifactFormat(row.format ?? row.type);
    if (!format) continue;
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 120) : `Agent ${format.toUpperCase()} output`;
    if (!definitions.some((entry) => entry.format === format && entry.name === name)) definitions.push({ format, name });
    if (definitions.length >= MAX_ARTIFACTS_PER_RUN) break;
  }
  return definitions.length ? definitions : [{ format: "markdown", name: "Agent result" }];
}
