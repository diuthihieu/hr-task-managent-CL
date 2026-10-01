import "server-only";
import { Prisma, type AgentApprovalKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aiConfigured, generate, parseJsonAnswer } from "@/lib/ai/gemini";
import { htmlToText } from "@/lib/ai/extract";
import { assertAgentRunTransition, ACTIVE_AGENT_RUN_STATUSES } from "./lifecycle";
import { AGENT_TOOLS, assertAgentToolsAllowed, requiredApprovalForText, SIMPLE_TASK_TOOLS } from "./tools";
import { generateAgentArtifacts } from "./artifacts";
import { normalizeOutputDefinitions } from "./artifact-contract";
import { readAgentTaskFiles, type AgentFileContext } from "./files";
import { badRequest, notFound, requireWorkspaceRole, visibleProjectWhere, visibleWikiWhere, type SessionUser } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { deleteAttachmentBlob, uploadAgentArtifact } from "@/lib/storage";

const STARTER_SKILL_KEY = "task-brief";
const STARTER_TOOLS = [...SIMPLE_TASK_TOOLS];
const STARTER_SCAN_SCOPE = { assignedToMe: true, createdByMe: true, includeAllVisible: false, projectIds: [] };

const RUN_INCLUDE = {
  task: { select: { id: true, title: true } },
  project: { select: { id: true, name: true } },
  skill: { select: { id: true, name: true, version: true } },
  outputs: { where: { deletedAt: null }, orderBy: { createdAt: "desc" as const }, select: { id: true, filename: true, type: true, mimeType: true, sizeBytes: true, createdAt: true, runId: true, task: { select: { id: true, title: true } }, project: { select: { id: true, name: true } }, skill: { select: { id: true, name: true } } } },
  approvals: { orderBy: { createdAt: "desc" as const }, select: { id: true, kind: true, status: true, reason: true } },
} satisfies Prisma.AgentRunInclude;

type RunWithDetails = Prisma.AgentRunGetPayload<{ include: typeof RUN_INCLUDE }>;

const SKILL_CONFIG_SELECT = {
  id: true,
  ownerId: true,
  name: true,
  description: true,
  instructions: true,
  triggers: true,
  inputSchema: true,
  workflow: true,
  toolsAllowed: true,
  referenceFiles: true,
  templates: true,
  validationRules: true,
  outputDefinitions: true,
  version: true,
} satisfies Prisma.AgentSkillSelect;

type SkillConfig = Prisma.AgentSkillGetPayload<{ select: typeof SKILL_CONFIG_SELECT }>;

interface SkillSnapshot {
  name: string;
  description: string | null;
  instructions: string;
  triggers: unknown;
  inputSchema: unknown;
  workflow: unknown;
  toolsAllowed: string[];
  referenceFiles: unknown;
  templates: unknown;
  validationRules: unknown;
  outputDefinitions: unknown;
  version: number;
}

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const iso = (value: Date | null) => value?.toISOString() ?? null;

function snapshotSkill(skill: SkillConfig, includeReferenceFiles = true): SkillSnapshot {
  return {
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    triggers: skill.triggers,
    inputSchema: skill.inputSchema,
    workflow: skill.workflow,
    toolsAllowed: skill.toolsAllowed,
    referenceFiles: includeReferenceFiles ? skill.referenceFiles : [],
    templates: skill.templates,
    validationRules: skill.validationRules,
    outputDefinitions: skill.outputDefinitions,
    version: skill.version,
  };
}

function runSkillSnapshot(run: { skillSnapshot: Prisma.JsonValue; skillVersion: number; skill: SkillConfig }): SkillSnapshot {
  const raw = run.skillSnapshot;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const value = raw as Record<string, Prisma.JsonValue>;
    if (typeof value.name === "string" && typeof value.instructions === "string" && Array.isArray(value.toolsAllowed)) {
      return {
        name: value.name,
        description: typeof value.description === "string" ? value.description : null,
        instructions: value.instructions,
        triggers: value.triggers ?? [],
        inputSchema: value.inputSchema ?? {},
        workflow: value.workflow ?? [],
        toolsAllowed: value.toolsAllowed.filter((tool): tool is string => typeof tool === "string"),
        referenceFiles: value.referenceFiles ?? [],
        templates: value.templates ?? [],
        validationRules: value.validationRules ?? [],
        outputDefinitions: value.outputDefinitions ?? [],
        version: run.skillVersion,
      };
    }
  }
  return snapshotSkill(run.skill);
}

export function serializeAgentRun(run: RunWithDetails) {
  const rawSnapshot = run.skillSnapshot && typeof run.skillSnapshot === "object" && !Array.isArray(run.skillSnapshot) ? run.skillSnapshot as Record<string, Prisma.JsonValue> : null;
  return {
    ...run,
    skill: { ...run.skill, name: typeof rawSnapshot?.name === "string" ? rawSnapshot.name : run.skill.name, version: run.skillVersion },
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    suggestedAt: run.suggestedAt.toISOString(),
    confirmedAt: iso(run.confirmedAt),
    startedAt: iso(run.startedAt),
    completedAt: iso(run.completedAt),
    cancelledAt: iso(run.cancelledAt),
    outputs: run.outputs.map((output) => ({ ...output, createdAt: output.createdAt.toISOString() })),
  };
}

export async function ensureAgentFoundation(workspaceId: string, userId: string) {
  const [settings, skill] = await prisma.$transaction(async (tx) => {
    const nextSettings = await tx.agentSettings.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, scanScope: json(STARTER_SCAN_SCOPE) },
      update: {},
    });
    const starter = await tx.agentSkill.upsert({
      where: { workspaceId_systemKey: { workspaceId, systemKey: STARTER_SKILL_KEY } },
      create: {
        workspaceId,
        systemKey: STARTER_SKILL_KEY,
        name: "Task Brief & Action Plan",
        description: "Summarize an accessible task, identify risks and produce a practical action plan.",
        instructions: "Use only facts from the task context. Produce a concise brief with: current situation, expected outcome, blockers/risks, recommended next actions, and open questions. Never invent people, dates or commitments.",
        triggers: json(["summarize task", "prepare action plan", "identify blockers", "overdue task", "task brief"]),
        inputSchema: json({ type: "object", required: ["taskId", "goal"], properties: { taskId: { type: "string", format: "uuid" }, goal: { type: "string" } } }),
        workflow: json(["Read the permitted task context", "Draft a grounded task brief", "Validate that no facts were invented", "Save output", "Comment result back to the task"]),
        toolsAllowed: STARTER_TOOLS,
        validationRules: json(["Use only supplied task data", "Call out missing information", "Do not perform external communication"]),
        outputDefinitions: json([{ format: "markdown", name: "Task brief" }]),
        visibility: "organization",
      },
      update: {},
    });
    await tx.agentSkillActivation.upsert({
      where: { skillId_userId: { skillId: starter.id, userId } },
      create: { skillId: starter.id, userId, active: false },
      update: {},
    });
    return [nextSettings, starter] as const;
  });
  return { settings, skill };
}

function accessibleSkillWhere(userId: string): Prisma.AgentSkillWhereInput {
  return {
    deletedAt: null,
    OR: [{ ownerId: userId }, { visibility: "organization" }, { visibility: "specific_people", shares: { some: { userId } } }],
  };
}

export async function listAgentSkills(workspaceId: string, userId: string) {
  await ensureAgentFoundation(workspaceId, userId);
  const rows = await prisma.agentSkill.findMany({
    where: { workspaceId, ...accessibleSkillWhere(userId) },
    include: { owner: { select: { id: true, name: true } }, activations: { where: { userId }, select: { active: true } }, shares: { select: { userId: true } } },
    orderBy: [{ systemKey: "desc" }, { updatedAt: "desc" }],
  });
  return rows.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    visibility: skill.visibility,
    systemKey: skill.systemKey,
    instructions: skill.instructions,
    triggers: skill.triggers,
    inputSchema: skill.inputSchema,
    workflow: skill.workflow,
    toolsAllowed: skill.toolsAllowed,
    referenceFiles: skill.ownerId === userId ? skill.referenceFiles : [],
    templates: skill.templates,
    validationRules: skill.validationRules,
    outputDefinitions: normalizeOutputDefinitions(skill.outputDefinitions),
    owner: skill.owner,
    ownedByMe: skill.ownerId === userId,
    shareWithUserIds: skill.ownerId === userId ? skill.shares.map((share) => share.userId) : [],
    active: skill.activations[0]?.active ?? false,
  }));
}

export async function getAgentSettings(workspaceId: string, userId: string) {
  const { settings } = await ensureAgentFoundation(workspaceId, userId);
  return {
    proactiveEnabled: settings.proactiveEnabled,
    suggestionMode: settings.suggestionMode,
    minimumConfidence: Number(settings.minimumConfidence),
    scanScope: { ...STARTER_SCAN_SCOPE, ...(settings.scanScope && typeof settings.scanScope === "object" && !Array.isArray(settings.scanScope) ? settings.scanScope : {}) },
    requireConfirmation: settings.requireConfirmation,
    automaticExecution: settings.automaticExecution,
  };
}

function suggestionSelect() {
  return {
    id: true,
    title: true,
    reason: true,
    proposedGoal: true,
    impact: true,
    confidence: true,
    status: true,
    createdAt: true,
    task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
    skill: { select: { id: true, name: true } },
    run: { select: { id: true, status: true, goal: true, plan: true } },
  } satisfies Prisma.AgentSuggestionSelect;
}

async function expireAgentSuggestions(userId: string, workspaceId: string) {
  const expired = await prisma.agentSuggestion.findMany({
    where: { workspaceId, userId, status: "open", expiresAt: { lte: new Date() } },
    orderBy: { expiresAt: "asc" },
    take: 100,
    select: { id: true, runId: true },
  });
  if (!expired.length) return;
  await prisma.$transaction(async (tx) => {
    for (const suggestion of expired) {
      const claimed = await tx.agentSuggestion.updateMany({ where: { id: suggestion.id, userId, status: "open" }, data: { status: "expired", decidedAt: new Date() } });
      if (!claimed.count) continue;
      const cancelled = await tx.agentRun.updateMany({ where: { id: suggestion.runId, userId, status: "suggested" }, data: { status: "cancelled", cancelledAt: new Date() } });
      if (cancelled.count) await tx.agentRunEvent.create({ data: { runId: suggestion.runId, fromStatus: "suggested", toStatus: "cancelled", message: "Agent suggestion expired before user confirmation" } });
    }
  });
}

export async function listAgentSuggestions(user: SessionUser, workspaceId: string) {
  await expireAgentSuggestions(user.id, workspaceId);
  const rows = await prisma.agentSuggestion.findMany({
    where: {
      workspaceId,
      userId: user.id,
      status: "open",
      expiresAt: { gt: new Date() },
      task: { deletedAt: null, project: { deletedAt: null, ...visibleProjectWhere(user) } },
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
    take: 20,
    select: suggestionSelect(),
  });
  return rows.map((row) => ({ ...row, confidence: Number(row.confidence), createdAt: row.createdAt.toISOString() }));
}

interface DetectionPick {
  taskId: string;
  skillId: string;
  confidence: number;
  title: string;
  reason: string;
  impact: string;
  goal: string;
}

function heuristicPick(task: DetectionTask, skillId: string): DetectionPick | null {
  const now = Date.now();
  const due = task.dueDate?.getTime() ?? null;
  const overdue = due !== null && due < now;
  const dueSoon = due !== null && due >= now && due < now + 3 * 86_400_000;
  const stale = task.status.category === "in_progress" && task.updatedAt.getTime() < now - 7 * 86_400_000;
  let confidence = overdue ? 0.97 : task.priority === "critical" ? 0.95 : task.priority === "high" && dueSoon ? 0.93 : stale ? 0.91 : 0.86;
  if (!task.description && !task.content) confidence -= 0.04;
  const reason = overdue ? "Task is overdue and can benefit from a focused recovery plan." : stale ? "In-progress task has not changed recently; the Agent can surface blockers and next steps." : "The task has enough context for the Agent to prepare a useful brief and action plan.";
  return { taskId: task.id, skillId, confidence, title: `AI can help: ${task.title}`, reason, impact: overdue ? "Reduce delay risk and clarify recovery actions." : "Save preparation time and make next actions explicit.", goal: `Prepare a grounded brief and action plan for “${task.title}”.` };
}

type DetectionTask = Awaited<ReturnType<typeof candidateTasks>>[number];

async function candidateTasks(user: SessionUser, workspaceId: string, scanScope: Record<string, unknown>) {
  const projectIds = Array.isArray(scanScope.projectIds) ? scanScope.projectIds.filter((id): id is string => typeof id === "string") : [];
  const includeAllVisible = scanScope.includeAllVisible === true;
  const ownership: Prisma.TaskWhereInput[] = [];
  if (scanScope.assignedToMe !== false) ownership.push({ assignees: { some: { userId: user.id } } });
  if (scanScope.createdByMe !== false) ownership.push({ createdById: user.id });
  return prisma.task.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      status: { category: { in: ["todo", "in_progress"] } },
      project: { deletedAt: null, ...visibleProjectWhere(user), ...(projectIds.length ? { id: { in: projectIds } } : {}) },
      ...(!includeAllVisible ? { OR: ownership.length ? ownership : [{ assignees: { some: { userId: user.id } } }] } : {}),
    },
    orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
    take: 40,
    select: {
      id: true,
      title: true,
      description: true,
      content: true,
      priority: true,
      progress: true,
      dueDate: true,
      updatedAt: true,
      projectId: true,
      project: { select: { name: true } },
      status: { select: { name: true, category: true } },
      assignees: { select: { user: { select: { name: true } } } },
    },
  });
}

export async function detectAgentSuggestions(user: SessionUser, workspaceId: string, manual: boolean) {
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  await expireAgentSuggestions(user.id, workspaceId);
  const settings = await getAgentSettings(workspaceId, user.id);
  if (!manual && (!settings.proactiveEnabled || settings.suggestionMode === "silent")) return [];
  const activeSkills = await prisma.agentSkill.findMany({
    where: { workspaceId, ...accessibleSkillWhere(user.id), activations: { some: { userId: user.id, active: true } } },
    select: SKILL_CONFIG_SELECT,
  });
  if (!activeSkills.length) return [];

  const tasks = await candidateTasks(user, ctx.workspaceId, settings.scanScope as Record<string, unknown>);
  if (!tasks.length) return [];
  const existing = await prisma.agentSuggestion.findMany({ where: { userId: user.id, taskId: { in: tasks.map((task) => task.id) }, status: { in: ["open", "accepted"] } }, select: { taskId: true, skillId: true } });
  const blocked = new Set(existing.map((row) => `${row.taskId}:${row.skillId}`));
  let picks: DetectionPick[] = [];

  if (aiConfigured()) {
    const payload = {
      skills: activeSkills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, triggers: skill.triggers })),
      tasks: tasks.slice(0, 25).map((task) => ({ id: task.id, title: task.title, project: task.project.name, status: task.status, priority: task.priority, progress: task.progress, dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null, updatedAt: task.updatedAt.toISOString(), description: task.description?.slice(0, 600) ?? htmlToText(task.content).slice(0, 600) })),
    };
    try {
      const response = await generate({
        workspaceId,
        system: "You are Woli Agent Detection. Select only tasks where an activated skill can materially help now. Be conservative: confidence >= 0.90 only. Never suggest actions beyond the supplied skills. Return JSON: {suggestions:[{taskId,skillId,confidence,title,reason,impact,goal}]}. At most 3 suggestions.",
        contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
        json: true,
        temperature: 0.1,
        maxOutputTokens: 1800,
      });
      const parsed = parseJsonAnswer<{ suggestions?: DetectionPick[] }>(response.text);
      picks = Array.isArray(parsed?.suggestions) ? parsed!.suggestions : [];
    } catch (error) {
      console.warn("[agent-work] AI detection failed; using conservative local scoring", error instanceof Error ? error.message : error);
    }
  }
  if (!picks.length) picks = tasks.map((task) => heuristicPick(task, activeSkills[0].id)).filter((pick): pick is DetectionPick => !!pick).slice(0, 3);

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const skillById = new Map(activeSkills.map((skill) => [skill.id, skill]));
  const skillIds = new Set(activeSkills.map((skill) => skill.id));
  const safePicks = picks
    .map((pick) => ({ ...pick, confidence: Math.min(1, Math.max(0, Number(pick.confidence))) }))
    .filter((pick) => taskById.has(pick.taskId) && skillIds.has(pick.skillId) && pick.confidence >= settings.minimumConfidence && !blocked.has(`${pick.taskId}:${pick.skillId}`))
    .slice(0, 3);

  for (const pick of safePicks) {
    const task = taskById.get(pick.taskId)!;
    const selectedSkill = skillById.get(pick.skillId)!;
    try {
      await prisma.$transaction(async (tx) => {
        const run = await tx.agentRun.create({ data: { workspaceId, userId: user.id, skillId: pick.skillId, skillVersion: selectedSkill.version, skillSnapshot: json(snapshotSkill(selectedSkill, selectedSkill.ownerId === user.id)), originType: "task", originId: task.id, projectId: task.projectId, taskId: task.id, goal: pick.goal.slice(0, 4000), inputs: json({ taskId: task.id, detection: "permission_filtered" }) } });
        await tx.agentSuggestion.create({ data: { workspaceId, userId: user.id, taskId: task.id, skillId: pick.skillId, runId: run.id, title: pick.title.slice(0, 240), reason: pick.reason.slice(0, 1200), proposedGoal: pick.goal.slice(0, 4000), impact: pick.impact.slice(0, 800), confidence: pick.confidence, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
        await tx.agentRunEvent.create({ data: { runId: run.id, actorId: user.id, toStatus: "suggested", message: "Agent detected a task it can help with", data: json({ confidence: pick.confidence }) } });
        await logActivity(tx, { workspaceId, actorId: user.id, entityType: "agent_run", entityId: run.id, action: "created", summary: `Agent suggested help for task: ${task.title}` });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  return listAgentSuggestions(user, workspaceId);
}

async function ownedRun(user: SessionUser, runId: string) {
  const run = await prisma.agentRun.findFirst({ where: { id: runId, userId: user.id }, include: { skill: { include: { activations: { where: { userId: user.id } } } }, task: { select: { id: true, workspaceId: true, projectId: true, title: true } }, conversation: { select: { id: true } } } });
  if (!run) throw notFound("Agent Run");
  await requireWorkspaceRole(user, { workspaceId: run.workspaceId, projectId: run.projectId }, "viewer");
  return run;
}

async function planForRun(user: SessionUser, runId: string) {
  const run = await ownedRun(user, runId);
  if (run.status === "planning") return getAgentRun(user, runId);
  if (run.status !== "confirming") throw badRequest(`Agent Run must be confirming before planning (is ${run.status})`);
  if (!run.skill.activations[0]?.active) throw badRequest("Activate this Skill before the Agent can use it");
  assertAgentRunTransition(run.status, "planning");
  const claimed = await prisma.$transaction(async (tx) => {
    const result = await tx.agentRun.updateMany({ where: { id: run.id, userId: user.id, status: "confirming" }, data: { status: "planning" } });
    if (!result.count) return false;
    await tx.agentRunEvent.create({ data: { runId: run.id, actorId: user.id, fromStatus: "confirming", toStatus: "planning", message: "Goal understood; preparing the execution plan" } });
    return true;
  });
  if (!claimed) return getAgentRun(user, run.id);
  const skill = runSkillSnapshot(run);
  let plan = ["Read the task context within your current permissions", "Apply the activated Skill instructions", "Validate the output against the Skill rules", "Save the output and comment the result back to the Task"];
  if (aiConfigured()) {
    try {
      const response = await generate({
        workspaceId: run.workspaceId,
        system: "Create a short execution plan for a Work Agent. Use only the supplied goal and Skill. Return JSON {steps:[string]}. Do not execute anything. Include validation and delivery back to the Task.",
        contents: [{ role: "user", parts: [{ text: JSON.stringify({ goal: run.goal, skill: { name: skill.name, version: skill.version, instructions: skill.instructions, workflow: skill.workflow, toolsAllowed: skill.toolsAllowed, validationRules: skill.validationRules, outputDefinitions: skill.outputDefinitions } }) }] }],
        json: true,
        temperature: 0.1,
        maxOutputTokens: 1000,
      });
      const parsed = parseJsonAnswer<{ steps?: string[] }>(response.text);
      if (Array.isArray(parsed?.steps) && parsed!.steps.length) plan = parsed!.steps.filter((step) => typeof step === "string").slice(0, 8);
    } catch (error) {
      console.warn("[agent-work] plan generation failed; using deterministic safe plan", error instanceof Error ? error.message : error);
    }
  }
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.agentRun.updateMany({ where: { id: run.id, userId: user.id, status: "planning" }, data: { plan: json(plan) } });
    if (!updated.count) return false;
    const conversation = run.conversation ?? (await tx.aiConversation.create({ data: { workspaceId: run.workspaceId, userId: user.id, kind: "agent", title: run.goal.slice(0, 200), originType: run.originType, originId: run.originId, projectId: run.projectId, taskId: run.taskId, skillId: run.skillId, agentRunId: run.id } }));
    await tx.aiMessage.createMany({ data: [{ conversationId: conversation.id, role: "user", content: run.goal }, { conversationId: conversation.id, role: "model", content: `Execution plan:\n${plan.map((step, index) => `${index + 1}. ${step}`).join("\n")}` }] });
    await tx.agentRunEvent.create({ data: { runId: run.id, actorId: user.id, fromStatus: "planning", toStatus: "planning", message: "Execution plan prepared and ready for confirmation", data: json({ plan }) } });
    return true;
  });
  if (!saved) return getAgentRun(user, run.id);
  return getAgentRun(user, run.id);
}

export async function decideSuggestion(user: SessionUser, suggestionId: string, decision: "accept" | "dismiss", customGoal?: string) {
  const suggestion = await prisma.agentSuggestion.findFirst({ where: { id: suggestionId, userId: user.id }, include: { run: true, task: { select: { workspaceId: true, projectId: true } } } });
  if (!suggestion) throw notFound("Suggestion");
  await requireWorkspaceRole(user, { workspaceId: suggestion.workspaceId, projectId: suggestion.task.projectId }, "viewer");
  if (suggestion.status !== "open") return getAgentRun(user, suggestion.runId);
  if (decision === "dismiss") {
    assertAgentRunTransition(suggestion.run.status, "cancelled");
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.agentSuggestion.updateMany({ where: { id: suggestion.id, userId: user.id, status: "open" }, data: { status: "dismissed", decidedAt: new Date() } });
      if (!claimed.count) return;
      const transitioned = await tx.agentRun.updateMany({ where: { id: suggestion.runId, userId: user.id, status: "suggested" }, data: { status: "cancelled", cancelledAt: new Date() } });
      if (!transitioned.count) throw badRequest("Agent Run changed while dismissing this suggestion");
      await tx.agentRunEvent.create({ data: { runId: suggestion.runId, actorId: user.id, fromStatus: "suggested", toStatus: "cancelled", message: "Suggestion dismissed by user" } });
    });
    return getAgentRun(user, suggestion.runId);
  }
  assertAgentRunTransition(suggestion.run.status, "confirming");
  const goal = customGoal?.trim() || suggestion.proposedGoal;
  const claimed = await prisma.$transaction(async (tx) => {
    const result = await tx.agentSuggestion.updateMany({ where: { id: suggestion.id, userId: user.id, status: "open" }, data: { status: "accepted", decidedAt: new Date() } });
    if (!result.count) return false;
    const transitioned = await tx.agentRun.updateMany({ where: { id: suggestion.runId, userId: user.id, status: "suggested" }, data: { status: "confirming", goal: goal.slice(0, 4000) } });
    if (!transitioned.count) throw badRequest("Agent Run changed while accepting this suggestion");
    await tx.agentRunEvent.create({ data: { runId: suggestion.runId, actorId: user.id, fromStatus: "suggested", toStatus: "confirming", message: "User accepted the suggestion; confirming goal before execution", data: json({ goal }) } });
    return true;
  });
  if (!claimed) return getAgentRun(user, suggestion.runId);
  return planForRun(user, suggestion.runId);
}

export async function getAgentRun(user: SessionUser, runId: string) {
  const row = await prisma.agentRun.findFirst({ where: { id: runId, userId: user.id }, include: RUN_INCLUDE });
  if (!row) throw notFound("Agent Run");
  await requireWorkspaceRole(user, { workspaceId: row.workspaceId, projectId: row.projectId }, "viewer");
  return serializeAgentRun(row);
}

async function requestSensitiveApproval(user: SessionUser, runId: string, kind: AgentApprovalKind, reason: string) {
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true } });
  assertAgentRunTransition(run.status, "waiting_approval");
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.agentRun.updateMany({ where: { id: runId, status: run.status }, data: { status: "waiting_approval" } });
    if (!claimed.count) return false;
    await tx.agentApproval.create({ data: { runId, kind, requestedById: user.id, approverId: user.id, reason } });
    await tx.agentRunEvent.create({ data: { runId, actorId: user.id, fromStatus: run.status, toStatus: "waiting_approval", message: "Human approval required before sensitive work", data: json({ kind }) } });
    return true;
  });
}

export async function approveAgentRun(user: SessionUser, runId: string, approved: boolean, note?: string) {
  const run = await ownedRun(user, runId);
  if (run.status !== "waiting_approval") throw badRequest("Agent Run is not waiting for approval");
  const approval = await prisma.agentApproval.findFirst({ where: { runId, approverId: user.id, status: "pending" }, orderBy: { createdAt: "desc" } });
  if (!approval) throw notFound("Approval request");
  const next = approved ? "planning" : "cancelled";
  assertAgentRunTransition(run.status, next);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.agentApproval.updateMany({ where: { id: approval.id, approverId: user.id, status: "pending" }, data: { status: approved ? "approved" : "rejected", decisionNote: note?.slice(0, 2000), decidedAt: new Date() } });
    if (!claimed.count) return;
    const transitioned = await tx.agentRun.updateMany({ where: { id: run.id, userId: user.id, status: "waiting_approval" }, data: { status: next, ...(approved ? {} : { cancelledAt: new Date() }) } });
    if (!transitioned.count) throw badRequest("Agent Run changed while recording this approval");
    await tx.agentRunEvent.create({ data: { runId: run.id, actorId: user.id, fromStatus: "waiting_approval", toStatus: next, message: approved ? "Sensitive action approved by user" : "Sensitive action rejected by user" } });
  });
  return getAgentRun(user, run.id);
}

async function executableTask(user: SessionUser, taskId: string) {
  return prisma.task.findFirstOrThrow({
    where: { id: taskId, deletedAt: null, project: { deletedAt: null, ...visibleProjectWhere(user) } },
    select: {
      id: true,
      title: true,
      description: true,
      content: true,
      priority: true,
      progress: true,
      startDate: true,
      dueDate: true,
      projectId: true,
      project: { select: { name: true } },
      workspace: { select: { slug: true } },
      status: { select: { name: true, category: true } },
      assignees: { select: { user: { select: { name: true } } } },
      comments: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 20, select: { body: true, createdAt: true, author: { select: { name: true } } } },
      attachments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, fileName: true, contentType: true, sizeBytes: true, storageProvider: true, url: true } },
    },
  });
}

export async function executeAgentRun(user: SessionUser, runId: string, confirmed: boolean) {
  const run = await ownedRun(user, runId);
  if (run.status !== "planning") throw badRequest(`Agent Run is not ready to execute (is ${run.status})`);
  if (!run.skill.activations[0]?.active) throw badRequest("Activate this Skill before the Agent can use it");
  const settings = await getAgentSettings(run.workspaceId, user.id);
  if (settings.requireConfirmation && !confirmed) throw badRequest("Execution confirmation is required");
  if (!run.task) throw badRequest("This phase executes Task-origin Agent Runs only");
  if (!Array.isArray(run.plan) || !run.plan.length) throw badRequest("The execution plan is still being prepared");
  const skill = runSkillSnapshot(run);
  const definitions = normalizeOutputDefinitions(skill.outputDefinitions);
  const task = await executableTask(user, run.task.id);
  const allowedTools = new Set(skill.toolsAllowed);
  const readFiles = task.attachments.length > 0 && allowedTools.has("file.read");
  const requestedTools = [
    "woli.read_task",
    ...(readFiles ? ["file.read"] : []),
    ...(definitions.some((definition) => ["markdown", "text", "json"].includes(definition.format)) ? ["artifact.save_text"] : []),
    ...(definitions.some((definition) => ["docx", "xlsx", "pptx", "pdf"].includes(definition.format)) ? ["artifact.generate"] : []),
    "woli.create_task_comment",
  ];
  try {
    assertAgentToolsAllowed(skill.toolsAllowed, requestedTools);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "Skill tool policy is invalid");
  }

  const fileContext: AgentFileContext[] = readFiles ? await readAgentTaskFiles(task.attachments, run.workspaceId) : task.attachments.map((file) => ({ id: file.id, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.sizeBytes, skippedReason: "Skill does not allow file.read" }));
  const approvalKind = requiredApprovalForText(`${run.goal}\n${task.title}\n${task.description ?? ""}\n${htmlToText(task.content)}\n${task.comments.map((comment) => comment.body).join("\n")}\n${fileContext.map((file) => file.text ?? "").join("\n")}`);
  const approved = approvalKind ? await prisma.agentApproval.findFirst({ where: { runId, kind: approvalKind, status: "approved" }, orderBy: { createdAt: "desc" } }) : null;
  if (approvalKind && !approved) {
    await requestSensitiveApproval(user, run.id, approvalKind, `The goal or Task contains sensitive ${approvalKind.replaceAll("_", " ")} context.`);
    return getAgentRun(user, run.id);
  }

  assertAgentRunTransition(run.status, "running");
  const executionClaimed = await prisma.$transaction(async (tx) => {
    const claimed = await tx.agentRun.updateMany({ where: { id: run.id, userId: user.id, status: "planning" }, data: { status: "running", confirmedAt: new Date(), startedAt: new Date() } });
    if (!claimed.count) return false;
    await tx.agentRunEvent.create({ data: { runId: run.id, actorId: user.id, fromStatus: "planning", toStatus: "running", message: "User confirmed goal and plan; execution started" } });
    return true;
  });
  if (!executionClaimed) return getAgentRun(user, run.id);

  const uploadedUrls: string[] = [];
  let committed = false;
  const cleanupUploads = async () => {
    if (committed || !uploadedUrls.length) return;
    await Promise.allSettled(uploadedUrls.map((url) => deleteAttachmentBlob(url)));
  };
  try {
    const context = {
      task: { title: task.title, description: task.description, content: htmlToText(task.content), project: task.project.name, status: task.status, priority: task.priority, progress: task.progress, startDate: task.startDate, dueDate: task.dueDate, assignees: task.assignees.map((row) => row.user.name) },
      recentComments: task.comments.reverse().map((comment) => ({ author: comment.author?.name ?? "Unknown", at: comment.createdAt, body: comment.body })),
      files: fileContext.map((file) => ({ fileName: file.fileName, contentType: file.contentType, sizeBytes: file.sizeBytes, text: file.text, skippedReason: file.skippedReason })),
    };
    const response = await generate({
      workspaceId: run.workspaceId,
      system: `You are executing an approved Woli Work Agent run.\n\nSKILL: ${skill.name} v${skill.version}\nINSTRUCTIONS:\n${skill.instructions}\nWORKFLOW:\n${JSON.stringify(skill.workflow)}\nVALIDATION RULES:\n${JSON.stringify(skill.validationRules)}\nTEMPLATES:\n${JSON.stringify(skill.templates)}\nREFERENCE FILE LABELS (no extra permission is implied):\n${JSON.stringify(skill.referenceFiles)}\n\nUse only the supplied context. Never claim an action was performed unless it appears in the context. Return one well-structured Markdown source that the Artifact Engine can render into the requested output formats.`,
      contents: [{ role: "user", parts: [{ text: `GOAL:\n${run.goal}\n\nPLAN:\n${JSON.stringify(run.plan)}\n\nTASK CONTEXT:\n${JSON.stringify(context)}` }] }],
      temperature: 0.2,
      maxOutputTokens: 5000,
    });
    const content = response.text.trim() || "No output was generated.";
    const summary = content.replace(/[#*_`>-]/g, "").replace(/\s+/g, " ").slice(0, 500);
    const artifacts = await generateAgentArtifacts({ taskTitle: task.title, markdown: content, definitions });
    const prepared = [] as Array<{ artifact: (typeof artifacts)[number]; storage: { url: string; pathname: string; provider: string } | null }>;
    for (const artifact of artifacts) {
      if (artifact.type !== "file") {
        prepared.push({ artifact, storage: null });
        continue;
      }
      const storage = await uploadAgentArtifact({ workspaceId: run.workspaceId, runId: run.id, filename: artifact.filename, mimeType: artifact.mimeType, data: artifact.bytes });
      uploadedUrls.push(storage.url);
      prepared.push({ artifact, storage });
    }
    const conversation = await prisma.aiConversation.findUnique({ where: { agentRunId: run.id }, select: { id: true } });
    const stillVisible = await prisma.task.count({ where: { id: task.id, deletedAt: null, project: { deletedAt: null, ...visibleProjectWhere(user) } } });
    if (!stillVisible) throw notFound("Task");
    const result = await prisma.$transaction(async (tx) => {
      const completed = await tx.agentRun.updateMany({
        where: { id: run.id, userId: user.id, status: "running" },
        data: { status: "completed", completedAt: new Date(), outputSummary: summary, toolsUsed: json(requestedTools), logs: json([{ level: "info", message: "Execution completed", fileCount: fileContext.length, outputCount: prepared.length, at: new Date().toISOString() }]) },
      });
      if (!completed.count) return null;
      const outputs = [];
      for (const item of prepared) {
        outputs.push(await tx.agentOutput.create({ data: { workspaceId: run.workspaceId, runId: run.id, skillId: run.skillId, conversationId: conversation?.id, taskId: task.id, projectId: task.projectId, createdById: user.id, filename: item.artifact.filename, type: item.artifact.type, mimeType: item.artifact.mimeType, sizeBytes: item.artifact.bytes.length, contentText: item.artifact.contentText, storageProvider: item.storage?.provider, storageKey: item.storage?.pathname, url: item.storage?.url } }));
      }
      const outputLinks = outputs.map((output) => `[${output.filename}](/api/agent-work/outputs/${output.id}/download)`).join(" · ");
      const comment = await tx.comment.create({ data: { taskId: task.id, authorId: user.id, agentRunId: run.id, body: `🤖 **Agent Work completed**\n\n${summary}\n\n${outputLinks}\n\n[Open Agent Run](/w/${task.workspace.slug}/agent-work?run=${run.id})` } });
      const toolUses = [
        { runId: run.id, toolName: "woli.read_task", riskLevel: "safe", status: "completed", input: json({ taskId: task.id }), output: json({ title: task.title, commentCount: task.comments.length, fileCount: task.attachments.length }), completedAt: new Date() },
        ...(readFiles ? [{ runId: run.id, toolName: "file.read", riskLevel: "safe", status: "completed", input: json({ taskId: task.id, attachmentIds: task.attachments.map((file) => file.id) }), output: json({ files: fileContext.map((file) => ({ id: file.id, fileName: file.fileName, readable: Boolean(file.text), skippedReason: file.skippedReason })) }), completedAt: new Date() }] : []),
        ...(outputs.some((output) => output.type !== "file") ? [{ runId: run.id, toolName: "artifact.save_text", riskLevel: "safe", status: "completed", input: json({ formats: definitions.filter((definition) => ["markdown", "text", "json"].includes(definition.format)).map((definition) => definition.format) }), output: json({ outputIds: outputs.filter((output) => output.type !== "file").map((output) => output.id) }), completedAt: new Date() }] : []),
        ...(outputs.some((output) => output.type === "file") ? [{ runId: run.id, toolName: "artifact.generate", riskLevel: "safe", status: "completed", input: json({ formats: definitions.filter((definition) => ["docx", "xlsx", "pptx", "pdf"].includes(definition.format)).map((definition) => definition.format) }), output: json({ outputIds: outputs.filter((output) => output.type === "file").map((output) => output.id) }), completedAt: new Date() }] : []),
        { runId: run.id, toolName: "woli.create_task_comment", riskLevel: "confirmation", status: "completed", input: json({ taskId: task.id }), output: json({ commentId: comment.id }), completedAt: new Date() },
      ];
      await tx.agentToolUse.createMany({ data: toolUses });
      if (conversation) {
        await tx.aiMessage.create({ data: { conversationId: conversation.id, role: "model", content, tokensIn: response.tokensIn, tokensOut: response.tokensOut } });
        await tx.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      }
      await tx.agentRun.update({ where: { id: run.id }, data: { outputsMeta: json(outputs.map((output) => ({ id: output.id, filename: output.filename, type: output.type, mimeType: output.mimeType, sizeBytes: output.sizeBytes }))) } });
      await tx.agentRunEvent.create({ data: { runId: run.id, actorId: user.id, fromStatus: "running", toStatus: "completed", message: "Artifact Bundle saved and result commented back to the Task", data: json({ outputIds: outputs.map((output) => output.id), commentId: comment.id }) } });
      await logActivity(tx, { workspaceId: run.workspaceId, actorId: user.id, entityType: "comment", entityId: comment.id, action: "created", summary: "Agent Work commented its completed result on the task", changes: { taskId: { from: null, to: task.id }, agentRunId: { from: null, to: run.id } } });
      await logActivity(tx, { workspaceId: run.workspaceId, actorId: user.id, entityType: "agent_run", entityId: run.id, action: "updated", summary: `Agent Run completed for task: ${task.title}`, changes: { status: { from: "running", to: "completed" } } });
      return outputs;
    });
    if (!result) {
      await cleanupUploads();
      return getAgentRun(user, run.id);
    }
    committed = true;
    return { run: await getAgentRun(user, run.id), outputIds: result.map((output) => output.id) };
  } catch (error) {
    await cleanupUploads();
    const message = error instanceof Error ? error.message.slice(0, 4000) : "Agent execution failed";
    await prisma.$transaction(async (tx) => {
      const failed = await tx.agentRun.updateMany({ where: { id: run.id, userId: user.id, status: "running" }, data: { status: "failed", failureReason: message } });
      if (failed.count) await tx.agentRunEvent.create({ data: { runId: run.id, actorId: user.id, fromStatus: "running", toStatus: "failed", level: "error", message } });
    });
    throw error;
  }
}

export async function cancelAgentRun(user: SessionUser, runId: string) {
  const run = await ownedRun(user, runId);
  if (!["suggested", "confirming", "planning", "running", "waiting_approval"].includes(run.status)) throw badRequest("This Agent Run can no longer be cancelled");
  assertAgentRunTransition(run.status, "cancelled");
  await prisma.$transaction(async (tx) => {
    const cancelled = await tx.agentRun.updateMany({ where: { id: run.id, userId: user.id, status: run.status }, data: { status: "cancelled", cancelledAt: new Date() } });
    if (cancelled.count) {
      await tx.agentSuggestion.updateMany({ where: { runId: run.id, userId: user.id, status: "open" }, data: { status: "dismissed", decidedAt: new Date() } });
      await tx.agentRunEvent.create({ data: { runId: run.id, actorId: user.id, fromStatus: run.status, toStatus: "cancelled", message: "Agent Run cancelled by user" } });
    }
  });
  return getAgentRun(user, run.id);
}

export async function getAgentWorkSnapshot(user: SessionUser, workspaceId: string) {
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  const projectVisibility: Prisma.AgentRunWhereInput = {
    OR: [{ projectId: null }, { project: { deletedAt: null, ...visibleProjectWhere(user) } }],
  };
  const outputProjectVisibility: Prisma.AgentOutputWhereInput = {
    OR: [{ projectId: null }, { project: { deletedAt: null, ...visibleProjectWhere(user) } }],
  };
  const conversationVisibility: Prisma.AiConversationWhereInput = {
    AND: [
      { OR: [{ projectId: null }, { project: { deletedAt: null, ...visibleProjectWhere(user) } }] },
      { OR: [{ wikiId: null }, { wiki: visibleWikiWhere(user, ctx.role) }] },
    ],
  };
  const [settings, suggestions, skills, activeRows, recentRows, outputRows, conversations, members] = await Promise.all([
    getAgentSettings(workspaceId, user.id),
    listAgentSuggestions(user, workspaceId),
    listAgentSkills(workspaceId, user.id),
    prisma.agentRun.findMany({ where: { workspaceId, userId: user.id, status: { in: ACTIVE_AGENT_RUN_STATUSES }, ...projectVisibility }, orderBy: { updatedAt: "desc" }, take: 30, include: RUN_INCLUDE }),
    prisma.agentRun.findMany({ where: { workspaceId, userId: user.id, status: { in: ["completed", "failed", "cancelled"] }, ...projectVisibility }, orderBy: { updatedAt: "desc" }, take: 30, include: RUN_INCLUDE }),
    prisma.agentOutput.findMany({ where: { workspaceId, createdById: user.id, deletedAt: null, ...outputProjectVisibility }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, filename: true, type: true, mimeType: true, sizeBytes: true, createdAt: true, runId: true, task: { select: { id: true, title: true } }, project: { select: { id: true, name: true } }, skill: { select: { id: true, name: true } } } }),
    prisma.aiConversation.findMany({ where: { workspaceId, userId: user.id, ...conversationVisibility }, orderBy: { updatedAt: "desc" }, take: 60, select: { id: true, title: true, kind: true, originType: true, originId: true, updatedAt: true, task: { select: { id: true, title: true } }, skill: { select: { id: true, name: true } }, agentRun: { select: { id: true, status: true } } } }),
    prisma.workspaceMember.findMany({ where: { workspaceId, user: { isActive: true, deletedAt: null } }, orderBy: { user: { name: "asc" } }, take: 500, select: { user: { select: { id: true, name: true } } } }),
  ]);
  return {
    configured: aiConfigured(),
    settings,
    suggestions,
    activeRuns: activeRows.map(serializeAgentRun),
    recentRuns: recentRows.map(serializeAgentRun),
    skills,
    outputs: outputRows.map((output) => ({ ...output, createdAt: output.createdAt.toISOString() })),
    history: conversations.map((conversation) => ({ ...conversation, updatedAt: conversation.updatedAt.toISOString() })),
    members: members.map((member) => member.user),
    tools: AGENT_TOOLS.filter((tool) => tool.available).map(({ name, label, category, risk }) => ({ name, label, category, risk })),
  };
}
