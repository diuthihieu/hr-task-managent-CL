import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aiConfigured, generate, parseJsonAnswer } from "@/lib/ai/gemini";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest, notFound } from "@/lib/authz";
import { listAgentSkills } from "@/lib/agent-work/engine";
import { agentSkillBodySchema, createAgentSkillSchema, defaultAgentSkillFields } from "@/lib/agent-work/skill-schema";

type P = { workspaceId: string };
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  return NextResponse.json(await listAgentSkills(workspaceId, user.id));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const body = createAgentSkillSchema.parse(await readJson(req));
  let name = body.name;
  let description = body.description;
  let instructions = body.instructions;
  let triggers = body.triggers ?? [];

  if (body.sourceConversationId) {
    const conversation = await prisma.aiConversation.findFirst({ where: { id: body.sourceConversationId, workspaceId, userId: user.id }, include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } } });
    if (!conversation) throw notFound("Conversation");
    await requireWorkspaceRole(user, { workspaceId, projectId: conversation.projectId, wikiId: conversation.wikiId }, "viewer");
    if (!aiConfigured()) throw badRequest("AI must be configured to create a Skill from a conversation");
    const response = await generate({
      workspaceId,
      system: "Turn this conversation into a reusable Woli Skill. Return JSON {name,description,instructions,triggers:string[]}. Instructions must describe a repeatable workflow, validation rules and expected output. Do not include private source facts in the reusable Skill.",
      contents: [{ role: "user", parts: [{ text: conversation.messages.map((message) => `${message.role}: ${message.content}`).join("\n\n").slice(0, 60_000) }] }],
      json: true,
      temperature: 0.1,
      maxOutputTokens: 2400,
    });
    const draft = parseJsonAnswer<{ name?: string; description?: string; instructions?: string; triggers?: string[] }>(response.text);
    name = name ?? draft?.name;
    description = description ?? draft?.description;
    instructions = instructions ?? draft?.instructions;
    triggers = body.triggers ?? draft?.triggers ?? [];
  }
  if (!name || !instructions) throw badRequest("name and instructions are required");

  const defaults = defaultAgentSkillFields();
  const fields = agentSkillBodySchema.parse({
    name,
    description: description ?? null,
    instructions,
    triggers,
    inputSchema: body.inputSchema ?? defaults.inputSchema,
    workflow: body.workflow ?? defaults.workflow,
    toolsAllowed: body.toolsAllowed ?? defaults.toolsAllowed,
    referenceFiles: body.referenceFiles ?? defaults.referenceFiles,
    templates: body.templates ?? defaults.templates,
    validationRules: body.validationRules ?? defaults.validationRules,
    outputDefinitions: body.outputDefinitions ?? defaults.outputDefinitions,
    visibility: body.visibility,
    shareWithUserIds: body.shareWithUserIds,
  });

  if (fields.visibility === "specific_people" && !fields.shareWithUserIds.length) throw badRequest("Choose at least one person to share this Skill with");
  if (fields.shareWithUserIds.length) {
    const count = await prisma.workspaceMember.count({ where: { workspaceId, userId: { in: fields.shareWithUserIds } } });
    if (count !== new Set(fields.shareWithUserIds).size) throw badRequest("Every shared person must belong to this workspace");
  }
  const skill = await prisma.$transaction(async (tx) => {
    const created = await tx.agentSkill.create({ data: { workspaceId, ownerId: user.id, name: fields.name, description: fields.description, instructions: fields.instructions, triggers: asJson(fields.triggers), inputSchema: asJson(fields.inputSchema), workflow: asJson(fields.workflow), toolsAllowed: fields.toolsAllowed, referenceFiles: asJson(fields.referenceFiles), templates: asJson(fields.templates), validationRules: asJson(fields.validationRules), outputDefinitions: asJson(fields.outputDefinitions), visibility: fields.visibility, sourceConversationId: body.sourceConversationId } });
    await tx.agentSkillActivation.create({ data: { skillId: created.id, userId: user.id, active: false } });
    if (fields.visibility === "specific_people") await tx.agentSkillShare.createMany({ data: fields.shareWithUserIds.map((userId) => ({ skillId: created.id, userId })), skipDuplicates: true });
    return created;
  });
  return NextResponse.json({ id: skill.id }, { status: 201 });
});
