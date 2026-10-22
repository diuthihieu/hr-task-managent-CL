import "server-only";
import { prisma } from "../prisma";
import { roleAtLeast, visibleProjectWhere, type SessionUser, type WorkspaceContext } from "../authz";
import { projectCaps } from "../project-permissions";
import { mentionedUserIds, stripMentions } from "../mentions";
import { PRIORITIES } from "../task-grid";
import { generate, parseJsonAnswer } from "./gemini";
import { SCOPE_GUARD } from "./personal";

/**
 * "Is this comment really a task?" - after someone comments on a task, the AI reads the comment and,
 * when it asks for or commits to a piece of work, proposes a task: title, description, due date,
 * priority, assignees and the project to put it in. Only projects where the commenter may create tasks
 * are offered, only members of the workspace can be proposed as assignees, and everything the model
 * returns is re-checked here (ids it did not get from us are dropped). Nothing is written: the user
 * confirms the proposal and it is created through the normal task API with its own checks.
 */

export const MIN_COMMENT_CHARS = 12;
const MAX_PROJECTS = 40;
const MAX_MEMBERS = 150;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CommentTaskSuggestion {
  suggest: boolean;
  /** Why there is no proposal: "short", "not_task", "no_project", "ai_off". */
  reason?: string;
  draft?: {
    title: string;
    description: string;
    projectId: string;
    dueDate: string | null;
    priority: (typeof PRIORITIES)[number];
    assigneeIds: string[];
    /** Make it a sub-task of the commented task (only possible in that task's project). */
    asSubtask: boolean;
  };
  why?: string;
  projects?: { id: string; name: string }[];
  members?: { id: string; name: string }[];
  source?: { taskId: string; projectId: string; taskTitle: string };
}

interface ModelAnswer {
  isTask?: boolean;
  confidence?: number;
  title?: string;
  description?: string;
  projectId?: string;
  dueDate?: string | null;
  priority?: string;
  assigneeIds?: string[];
  reason?: string;
}

export function commentPlainText(body: string): string {
  return stripMentions(body)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Today's date in Vietnam (the product's home time zone), for "by Friday"-style deadlines. */
function todayVN(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}

/** Projects of the workspace the user can see and create tasks in; the commented task's project first. */
async function creatableProjects(ctx: WorkspaceContext, user: SessionUser, currentProjectId: string) {
  if (!roleAtLeast(ctx.role, "contributor")) return [];
  const projects = await prisma.project.findMany({
    where: { workspaceId: ctx.workspaceId, deletedAt: null, status: { not: "archived" }, ...visibleProjectWhere(user) },
    select: { id: true, name: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_PROJECTS * 2,
  });
  projects.sort((a, b) => Number(b.id === currentProjectId) - Number(a.id === currentProjectId));
  const out: { id: string; name: string }[] = [];
  for (const p of projects) {
    if (out.length >= MAX_PROJECTS) break;
    if ((await projectCaps(ctx, p.id)).has("task.create")) out.push(p);
  }
  return out;
}

export function validateAnswer(
  a: ModelAnswer | null,
  o: { projects: { id: string }[]; members: { id: string }[]; currentProjectId: string; text: string }
): CommentTaskSuggestion["draft"] | null {
  if (!a || a.isTask !== true || (typeof a.confidence === "number" && a.confidence < 0.6)) return null;
  const title = (typeof a.title === "string" ? a.title : "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) return null;
  const projectIds = new Set(o.projects.map((p) => p.id));
  const projectId = typeof a.projectId === "string" && projectIds.has(a.projectId) ? a.projectId : projectIds.has(o.currentProjectId) ? o.currentProjectId : o.projects[0]?.id;
  if (!projectId) return null;
  const memberIds = new Set(o.members.map((m) => m.id));
  const assigneeIds = [...new Set((Array.isArray(a.assigneeIds) ? a.assigneeIds : []).filter((id): id is string => typeof id === "string" && memberIds.has(id)))].slice(0, 10);
  const due = typeof a.dueDate === "string" && DATE.test(a.dueDate) && !Number.isNaN(new Date(`${a.dueDate}T00:00:00Z`).getTime()) ? a.dueDate : null;
  const priority = PRIORITIES.includes(a.priority as (typeof PRIORITIES)[number]) ? (a.priority as (typeof PRIORITIES)[number]) : "medium";
  const description = (typeof a.description === "string" && a.description.trim() ? a.description.trim() : o.text).slice(0, 2000);
  return { title, description, projectId, dueDate: due, priority, assigneeIds, asSubtask: projectId === o.currentProjectId };
}

export async function suggestTaskFromComment(o: { user: SessionUser; ctx: WorkspaceContext; comment: { id: string; body: string; taskId: string }; task: { id: string; title: string; projectId: string; projectName: string } }): Promise<CommentTaskSuggestion> {
  const text = commentPlainText(o.comment.body);
  if (text.length < MIN_COMMENT_CHARS) return { suggest: false, reason: "short" };
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: o.ctx.workspaceId }, select: { name: true, aiEnabled: true } });
  if (!ws.aiEnabled) return { suggest: false, reason: "ai_off" };

  const projects = await creatableProjects(o.ctx, o.user, o.task.projectId);
  if (!projects.length) return { suggest: false, reason: "no_project" };

  // People who could be asked to do it: workspace members (mentioned ones first).
  const mentioned = new Set(mentionedUserIds(o.comment.body));
  const members = (
    await prisma.workspaceMember.findMany({
      where: { workspaceId: o.ctx.workspaceId, user: { isActive: true, deletedAt: null } },
      select: { user: { select: { id: true, name: true } } },
      take: MAX_MEMBERS,
    })
  )
    .map((m) => m.user)
    .sort((a, b) => Number(mentioned.has(b.id)) - Number(mentioned.has(a.id)));

  const system = [
    "You read one comment written on a task in the work-management app woli and decide whether it asks for, assigns or commits to a NEW piece of work that should be tracked as its own task.",
    "A task: a concrete action someone must do (\"please send the contract to Lan by Friday\", \"I will prepare the onboarding slides\", \"cần đặt laptop cho nhân viên mới trước 15/11\").",
    "NOT a task: status updates, questions, thanks, opinions, approvals, information, or work already done.",
    SCOPE_GUARD,
    "Answer only with JSON. RESPONSE_SCHEMA: comment_task",
    '{"isTask":boolean,"confidence":0..1,"title":"short imperative title in the comment\'s language","description":"1-3 sentences with the details from the comment","projectId":"one id from PROJECTS","dueDate":"YYYY-MM-DD or null","priority":"low|medium|high|critical","assigneeIds":["ids from MEMBERS only"],"reason":"one short sentence why, in the comment\'s language"}',
    `Today is ${todayVN()} (Asia/Ho_Chi_Minh). Resolve relative dates ("Friday", "tuần sau", "cuối tháng") from it; no date in the comment -> null.`,
    "Pick the project the work belongs to; when unsure use the first project (the one the comment was written in).",
    "Assignees: people named or @mentioned as the ones who should do it; if the writer commits to it themselves, the writer. Otherwise none.",
    "",
    `Workspace: ${ws.name}`,
    `Comment writer: ${o.user.name} (member id: ${o.user.id})`,
    `Commented task: "${o.task.title}" in project "${o.task.projectName}"`,
    "PROJECTS:",
    ...projects.map((p) => `- project id: ${p.id} | ${p.name}`),
    "MEMBERS:",
    ...members.map((m) => `- member id: ${m.id} | ${m.name}${mentioned.has(m.id) ? " (mentioned)" : ""}`),
  ].join("\n");

  const { text: answer } = await generate({
    workspaceId: o.ctx.workspaceId,
    system,
    contents: [{ role: "user", parts: [{ text: `COMMENT:\n${text.slice(0, 4000)}` }] }],
    json: true,
    temperature: 0.1,
    maxOutputTokens: 800,
    timeBudgetMs: 25_000,
  });
  const parsed = parseJsonAnswer<ModelAnswer>(answer);
  const draft = validateAnswer(parsed, { projects, members, currentProjectId: o.task.projectId, text });
  if (!draft) return { suggest: false, reason: "not_task" };
  const shown = new Set([...draft.assigneeIds, ...mentioned]);
  return {
    suggest: true,
    draft,
    why: typeof parsed?.reason === "string" ? parsed.reason.slice(0, 300) : undefined,
    projects,
    members: members.filter((m) => shown.has(m.id)).concat(members.filter((m) => !shown.has(m.id))).slice(0, MAX_MEMBERS),
    source: { taskId: o.task.id, projectId: o.task.projectId, taskTitle: o.task.title },
  };
}
