import { z } from "zod";
import { AGENT_ARTIFACT_FORMATS } from "./artifact-contract";
import { AGENT_TOOLS } from "./tools";
import { uuid } from "@/lib/validation";

const AVAILABLE_TOOL_NAMES = new Set(AGENT_TOOLS.filter((tool) => tool.available).map((tool) => tool.name));

const stringList = (maxItems: number, maxLength: number) => z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);
const outputDefinition = z.object({
  format: z.enum(AGENT_ARTIFACT_FORMATS),
  name: z.string().trim().min(1).max(120),
});

/** "/bao-cao-tuan": lower-case letters, digits and dashes (Vietnamese accents are removed by the client). */
export const SKILL_COMMAND = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
export const SKILL_PARAMETER_TYPES = ["text", "date_range", "projects", "people"] as const;
export const DATE_PRESETS = ["this_week", "last_week", "this_month", "last_month", "last_7_days", "last_30_days"] as const;
export const DATE_FIELDS = ["completed", "due", "start", "updated"] as const;
export const skillParameter = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(80),
  type: z.enum(SKILL_PARAMETER_TYPES),
  required: z.boolean().default(false),
  /** date_range: a preset; projects / people: "me" or empty; text: a default text. */
  default: z.string().trim().max(500).optional(),
  /** date_range only: which task date the range filters on. */
  dateField: z.enum(DATE_FIELDS).optional(),
});
export type SkillParameter = z.infer<typeof skillParameter>;

export const agentSkillBodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  instructions: z.string().trim().min(10).max(30_000),
  triggers: stringList(30, 200).default([]),
  inputSchema: z.record(z.string(), z.unknown()).default({}),
  workflow: stringList(30, 1000).min(1).default(["Read permitted context", "Apply instructions", "Validate output", "Return result to source Task"]),
  toolsAllowed: stringList(20, 120).min(1).refine((tools) => tools.every((tool) => AVAILABLE_TOOL_NAMES.has(tool)), "Skill contains an unavailable Tool"),
  referenceFiles: stringList(30, 1000).default([]),
  templates: stringList(30, 5000).default([]),
  validationRules: stringList(30, 1000).min(1),
  outputDefinitions: z.array(outputDefinition).min(1).max(5),
  visibility: z.enum(["private", "specific_people", "organization"]).default("private"),
  shareWithUserIds: z.array(uuid).max(100).default([]),
  command: z.string().trim().toLowerCase().regex(SKILL_COMMAND, "Command: 3-60 lower-case letters, digits or dashes").nullable().optional(),
  parameters: z.array(skillParameter).max(8).refine((list) => new Set(list.map((p) => p.key)).size === list.length, "Parameter keys must be unique").default([]),
});

export const createAgentSkillSchema = agentSkillBodySchema.partial({
  name: true,
  instructions: true,
  toolsAllowed: true,
  validationRules: true,
  outputDefinitions: true,
}).extend({ sourceConversationId: uuid.optional() });

export type AgentSkillBody = z.infer<typeof agentSkillBodySchema>;

export function defaultAgentSkillFields() {
  return {
    inputSchema: { type: "object", properties: { taskId: { type: "string", format: "uuid" }, goal: { type: "string" } }, required: ["taskId", "goal"] },
    workflow: ["Read permitted context", "Apply instructions", "Validate output", "Save output", "Return result to source Task"],
    toolsAllowed: ["woli.read_task", "file.read", "artifact.save_text", "woli.create_task_comment"],
    referenceFiles: [] as string[],
    templates: [] as string[],
    validationRules: ["Never exceed the current user's permissions", "Do not invent facts", "Require approval for sensitive actions"],
    outputDefinitions: [{ format: "markdown" as const, name: "Agent result" }],
  };
}
