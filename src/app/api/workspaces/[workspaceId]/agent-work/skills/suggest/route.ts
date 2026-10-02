import { NextResponse } from "next/server";
import { z } from "zod";
import { aiConfigured, generate, parseJsonAnswer } from "@/lib/ai/gemini";
import { badRequest, requireUser, requireWorkspaceRole, readJson, route } from "@/lib/authz";
import { AGENT_ARTIFACT_FORMATS } from "@/lib/agent-work/artifact-contract";
import { AGENT_TOOLS } from "@/lib/agent-work/tools";

type P = { workspaceId: string };

const requestSchema = z.object({
  description: z.string().trim().min(10).max(4000),
  clarification: z.string().trim().max(4000).optional(),
  previousDraft: z.unknown().optional(),
});
const draftSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000),
  triggers: z.array(z.string().trim().min(1).max(200)).max(20),
  workflow: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
  inputFields: z.array(z.enum(["goal", "task", "project", "dueDate", "files", "extraInstructions"])).min(1),
  toolsAllowed: z.array(z.string()).min(1),
  validationRules: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
  outputFormats: z.array(z.enum(AGENT_ARTIFACT_FORMATS)).min(1).max(5),
  questions: z.array(z.string().trim().min(1).max(500)).max(5).default([]),
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  if (!aiConfigured()) throw badRequest("AI must be configured to suggest a Skill");
  const body = requestSchema.parse(await readJson(req));
  const availableTools = AGENT_TOOLS.filter((tool) => tool.available).map((tool) => ({ name: tool.name, label: tool.label, risk: tool.risk }));
  const response = await generate({
    workspaceId,
    json: true,
    temperature: body.previousDraft ? 0.55 : 0.25,
    maxOutputTokens: 3000,
    system: "You are Woli's no-code Skill designer. Turn a short business request into a safe, reusable Agent Skill. Return JSON only. Never include source data or permissions in a reusable Skill. The workflow must be plain language, one concrete action per step. Pick only tools from AVAILABLE_TOOLS. Sensitive or external actions must remain approval-gated. Ask concise questions only when an answer would materially change the Skill; still produce a usable draft.",
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ request: body.description, clarification: body.clarification ?? null, previousDraft: body.previousDraft ?? null, availableInputFields: ["goal", "task", "project", "dueDate", "files", "extraInstructions"], availableOutputFormats: AGENT_ARTIFACT_FORMATS, availableTools, requiredShape: { name: "string", description: "string", triggers: ["string"], workflow: ["string"], inputFields: ["allowed input field"], toolsAllowed: ["available tool name"], validationRules: ["string"], outputFormats: ["available format"], questions: ["string"] } }) }] }],
  });
  const parsed = draftSchema.safeParse(parseJsonAnswer<unknown>(response.text));
  if (!parsed.success) throw badRequest("AI returned an incomplete Skill draft. Please try regenerating it.");
  const allowed = new Set(availableTools.map((tool) => tool.name));
  if (!parsed.data.toolsAllowed.every((tool) => allowed.has(tool))) throw badRequest("AI suggested a Tool that is not available");
  return NextResponse.json(parsed.data);
});
