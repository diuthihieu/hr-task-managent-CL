// Scheduled workflows: a Skill run on a schedule for its owner, with the owner's permissions at each run,
// delivered to the owner's Woli AI inbox. Supabase pg_cron calls /api/workflows/tick every few minutes;
// a due workflow is claimed (next run moved on, a short lock set) before it runs, so two ticks never
// run it twice. Three failures in a row pause it and tell the owner.
import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, forbidden, requireWorkspaceRole, visibleProjectWhere, type SessionUser } from "@/lib/authz";
import { postBotMessage } from "@/lib/messaging/service";
import { fitMessage } from "@/lib/messaging/fit-message";
import { runWithAiContext } from "@/lib/ai/usage";
import { accessibleAgentSkillWhere } from "./access";
import { normalizeCommandArgs } from "./command-args";
import { skillParameter } from "./skill-schema";
import { startCommandRun } from "./engine";
import { nextRunAt, workflowSchedule, type WorkflowSchedule } from "./schedule";

export const MAX_ACTIVE_WORKFLOWS = 10;
export const MAX_FAILURES = 3;
const LOCK_MS = 10 * 60_000;

export const workflowBody = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  skillId: z.string().uuid(),
  args: z.record(z.string(), z.unknown()).default({}),
  note: z.string().trim().max(2000).nullable().optional(),
  schedule: workflowSchedule,
  active: z.boolean().default(true),
});
export type WorkflowBody = z.infer<typeof workflowBody>;

/**
 * A change to a workflow: only the fields sent. Not `workflowBody.partial()` - with Zod 4 that still
 * fills the creation defaults in, so pausing would wipe the arguments and any edit would switch it on.
 */
export const workflowPatch = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  skillId: z.string().uuid().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  schedule: workflowSchedule.optional(),
  active: z.boolean().optional(),
});
export type WorkflowPatch = z.infer<typeof workflowPatch>;

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/** Checks the Skill is usable by this person and the arguments fit its parameters (as of now). */
async function validate(user: SessionUser, workspaceId: string, body: Pick<WorkflowBody, "skillId" | "args">) {
  const skill = await prisma.agentSkill.findFirst({ where: { id: body.skillId, workspaceId, ...accessibleAgentSkillWhere(user.id) }, select: { id: true, parameters: true } });
  if (!skill) throw notFound("Skill");
  const parsed = z.array(skillParameter).safeParse(skill.parameters);
  const [projects, members] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId, deletedAt: null, ...visibleProjectWhere(user) }, select: { id: true } }),
    prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } }),
  ]);
  try {
    normalizeCommandArgs(parsed.success ? parsed.data : [], body.args, { userId: user.id, projectIds: new Set(projects.map((p) => p.id)), memberIds: new Set(members.map((m) => m.userId)) });
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : "Invalid arguments");
  }
}

async function assertActiveRoom(ownerId: string, exceptId?: string) {
  const active = await prisma.agentWorkflow.count({ where: { ownerId, active: true, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (active >= MAX_ACTIVE_WORKFLOWS) throw badRequest(`At most ${MAX_ACTIVE_WORKFLOWS} active workflows per person - pause one first`);
}

const SELECT = {
  id: true, name: true, description: true, skillId: true, args: true, note: true, schedule: true, active: true, nextRunAt: true, lastRunAt: true, lastRunId: true, lastStatus: true, lastError: true, failureCount: true, createdAt: true,
  skill: { select: { name: true, command: true, parameters: true, deletedAt: true } },
} satisfies Prisma.AgentWorkflowSelect;

export async function listWorkflows(user: SessionUser, workspaceId: string) {
  await requireWorkspaceRole(user, workspaceId, "viewer");
  return prisma.agentWorkflow.findMany({ where: { workspaceId, ownerId: user.id }, select: SELECT, orderBy: { createdAt: "desc" } });
}

export async function createWorkflow(user: SessionUser, workspaceId: string, body: WorkflowBody) {
  await requireWorkspaceRole(user, workspaceId, "viewer");
  await validate(user, workspaceId, body);
  if (body.active) await assertActiveRoom(user.id);
  return prisma.agentWorkflow.create({
    data: { workspaceId, ownerId: user.id, skillId: body.skillId, name: body.name, description: body.description ?? null, args: json(body.args), note: body.note ?? null, schedule: json(body.schedule), active: body.active, nextRunAt: nextRunAt(body.schedule, new Date()) },
    select: SELECT,
  });
}

async function owned(user: SessionUser, id: string) {
  const w = await prisma.agentWorkflow.findUnique({ where: { id } });
  if (!w || w.ownerId !== user.id) throw notFound("Workflow");
  await requireWorkspaceRole(user, w.workspaceId, "viewer");
  return w;
}

export async function updateWorkflow(user: SessionUser, id: string, patch: WorkflowPatch) {
  const w = await owned(user, id);
  const merged = { skillId: patch.skillId ?? w.skillId, args: (patch.args ?? w.args) as Record<string, unknown> };
  if (patch.skillId || patch.args) await validate(user, w.workspaceId, merged);
  const reactivating = patch.active === true && !w.active;
  if (reactivating) await assertActiveRoom(user.id, id);
  const schedule = patch.schedule ?? (w.schedule as WorkflowSchedule);
  return prisma.agentWorkflow.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.skillId ? { skillId: patch.skillId } : {}),
      ...(patch.args ? { args: json(patch.args) } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.schedule ? { schedule: json(patch.schedule) } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      // A new schedule or a restart counts from now; a restart also forgets old failures.
      ...(patch.schedule || reactivating ? { nextRunAt: nextRunAt(schedule, new Date()) } : {}),
      ...(reactivating ? { failureCount: 0, lastError: null } : {}),
    },
    select: SELECT,
  });
}

export async function deleteWorkflow(user: SessionUser, id: string) {
  await owned(user, id);
  await prisma.agentWorkflow.delete({ where: { id } });
}

/** The owner as a session user, or null when they can no longer run anything (deactivated, deleted). */
async function ownerSession(ownerId: string): Promise<SessionUser | null> {
  return prisma.user.findFirst({
    where: { id: ownerId, isActive: true, deletedAt: null },
    select: { id: true, email: true, name: true, systemRole: true, mustChangePassword: true, avatarColor: true, locale: true, emailVerifiedAt: true },
  });
}

type Outcome = { status: "completed" | "waiting_approval" | "failed"; runId: string | null; error?: string };

/** Runs one workflow now and reports to the owner's inbox. Never throws. */
export async function executeWorkflow(workflowId: string): Promise<Outcome> {
  const w = await prisma.agentWorkflow.findUnique({ where: { id: workflowId }, include: { workspace: { select: { slug: true, deletedAt: true } }, skill: { select: { deletedAt: true } } } });
  if (!w) return { status: "failed", runId: null, error: "Workflow not found" };
  const user = await ownerSession(w.ownerId);
  let outcome: Outcome;
  if (!user || w.workspace.deletedAt) {
    // Nobody to run it for: stop quietly (the account or workspace is gone).
    await prisma.agentWorkflow.update({ where: { id: w.id }, data: { active: false, lockedUntil: null, lastStatus: "failed", lastError: "The owner or the workspace is no longer active" } });
    return { status: "failed", runId: null, error: "inactive owner" };
  }
  try {
    if (w.skill.deletedAt) throw new Error("The Skill was deleted");
    // The tick has no signed-in request: AI calls are counted against, and limited for, the owner.
    const result = await runWithAiContext({ feature: "agent-workflow", userId: user.id }, () => startCommandRun(user, w.workspaceId, { skillId: w.skillId, args: (w.args ?? {}) as Record<string, unknown>, note: w.note ?? undefined, workflowId: w.id }));
    const run = result.run as { id: string; status: string; failureReason?: string | null; outputs?: { id: string }[] };
    const link = `/w/${w.workspace.slug}/agent-work?run=${run.id}`;
    if (run.status === "completed") {
      const content = "content" in result && typeof result.content === "string" ? result.content : "";
      const outputIds = "outputIds" in result && Array.isArray(result.outputIds) ? (result.outputIds as string[]) : (run.outputs ?? []).map((o) => o.id);
      // The full result is in the attached files and the run; the message carries what fits, cut at a block.
      const full = `**${w.name}**\n\n${content}`;
      const body = full.length > 3600 ? `${fitMessage(full, 3600)}\n\n[${w.name}](${link})` : full;
      await postBotMessage(w.ownerId, body, { outputIds });
      outcome = { status: "completed", runId: run.id };
    } else if (run.status === "waiting_approval") {
      await postBotMessage(w.ownerId, `**${w.name}**\n\nThis run mentions sensitive data and waits for your approval: ${link}`);
      outcome = { status: "waiting_approval", runId: run.id };
    } else {
      throw new Error(run.failureReason || `The run ended as ${run.status}`);
    }
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 900);
    outcome = { status: "failed", runId: null, error: message };
  }
  const failures = outcome.status === "failed" ? w.failureCount + 1 : 0;
  const pause = failures >= MAX_FAILURES;
  await prisma.agentWorkflow.update({
    where: { id: w.id },
    data: { lastRunAt: new Date(), lastRunId: outcome.runId, lastStatus: outcome.status, lastError: outcome.error ?? null, failureCount: failures, lockedUntil: null, ...(pause ? { active: false } : {}) },
  });
  if (outcome.status === "failed") {
    await postBotMessage(w.ownerId, `**${w.name}** could not run: ${outcome.error}${pause ? `\n\nIt failed ${MAX_FAILURES} times in a row and is now paused. Fix it in Agent Work → Workflows, then turn it back on.` : ""}`).catch((e) => console.error("[workflow] could not report", e));
  }
  return outcome;
}

/** Run now (the owner's "Run now" button): same as a scheduled run, the schedule is untouched. */
export async function runWorkflowNow(user: SessionUser, id: string) {
  const w = await owned(user, id);
  const now = new Date();
  const claimed = await prisma.agentWorkflow.updateMany({ where: { id: w.id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(now.getTime() + LOCK_MS) } });
  if (!claimed.count) throw forbidden("This workflow is already running");
  return executeWorkflow(w.id);
}

/**
 * Runs what is due, oldest first, until the time budget is spent (the rest waits for the next tick).
 * Each workflow is claimed first: its next run moves on and a lock is set in one conditional update.
 */
export async function runDueWorkflows(budgetMs: number, now = new Date()) {
  const started = Date.now();
  const due = await prisma.agentWorkflow.findMany({
    where: { active: true, nextRunAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    orderBy: { nextRunAt: "asc" },
    take: 25,
    select: { id: true, nextRunAt: true, schedule: true },
  });
  const done: { id: string; status: string }[] = [];
  for (const w of due) {
    if (Date.now() - started > budgetMs) break;
    const parsed = workflowSchedule.safeParse(w.schedule);
    if (!parsed.success) {
      await prisma.agentWorkflow.update({ where: { id: w.id }, data: { active: false, lastStatus: "failed", lastError: "Invalid schedule" } });
      continue;
    }
    const claimed = await prisma.agentWorkflow.updateMany({
      where: { id: w.id, active: true, nextRunAt: w.nextRunAt, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { nextRunAt: nextRunAt(parsed.data, new Date()), lockedUntil: new Date(Date.now() + LOCK_MS) },
    });
    if (!claimed.count) continue; // another tick took it
    const r = await executeWorkflow(w.id);
    done.push({ id: w.id, status: r.status });
  }
  return { due: due.length, ran: done };
}
