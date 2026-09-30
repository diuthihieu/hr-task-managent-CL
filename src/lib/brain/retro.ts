import "server-only";
import { prisma } from "../prisma";
import { taskContext } from "../ai/actions";
import { stripMentions } from "../mentions";
import { htmlToText } from "../ai/extract";

// Context for the AI retrospective of a finished task or project: what
// happened (status / date changes from the activity log), what people said
// (comments), what was produced (files), estimates vs actuals, decisions.

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "-");

function historyLines(rows: { createdAt: Date; action: string; summary: string | null; changes: unknown; actor: { name: string } | null }[]) {
  return rows.map((r) => {
    const ch = r.changes && typeof r.changes === "object" ? Object.entries(r.changes as Record<string, { from: unknown; to: unknown }>).map(([k, v]) => `${k}: ${JSON.stringify(v?.from)} → ${JSON.stringify(v?.to)}`).join("; ") : "";
    return `- ${day(r.createdAt)} ${r.actor?.name ?? "system"}: ${r.summary ?? r.action}${ch ? ` (${ch})` : ""}`;
  });
}

export async function taskRetroContext(taskId: string) {
  const [base, history, files, decisions] = await Promise.all([
    taskContext(taskId),
    prisma.activityLog.findMany({ where: { entityType: "task", entityId: taskId }, orderBy: { createdAt: "asc" }, take: 120, select: { createdAt: true, action: true, summary: true, changes: true, actor: { select: { name: true } } } }),
    prisma.attachment.findMany({ where: { taskId, deletedAt: null }, select: { fileName: true, createdAt: true, extractedText: true } }),
    prisma.decision.findMany({ where: { taskId, deletedAt: null }, select: { title: true, reason: true } }),
  ]);
  return [
    base,
    `HISTORY (status, dates and field changes):\n${historyLines(history).join("\n") || "(none)"}`,
    `FILES:\n${files.map((f) => `- ${f.fileName} (${day(f.createdAt)})${f.extractedText ? `: ${f.extractedText.slice(0, 600)}` : ""}`).join("\n") || "(none)"}`,
    `RECORDED DECISIONS:\n${decisions.map((d) => `- ${d.title}${d.reason ? ` - ${d.reason}` : ""}`).join("\n") || "(none)"}`,
  ].join("\n\n");
}

export async function projectRetroContext(projectId: string) {
  const p = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      name: true,
      description: true,
      status: true,
      startDate: true,
      endDate: true,
      owner: { select: { name: true } },
      tasks: {
        where: { deletedAt: null },
        select: { id: true, title: true, dueDate: true, completedAt: true, estimateMinutes: true, actualMinutes: true, status: { select: { name: true, category: true } }, assignees: { select: { user: { select: { name: true } } } } },
        take: 400,
      },
    },
  });
  const taskIds = p.tasks.map((t) => t.id);
  const [comments, history, files, decisions] = await Promise.all([
    prisma.comment.findMany({ where: { taskId: { in: taskIds }, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 80, select: { body: true, createdAt: true, author: { select: { name: true } }, task: { select: { title: true } } } }),
    prisma.activityLog.findMany({ where: { OR: [{ entityType: "project", entityId: projectId }, { entityType: "task", entityId: { in: taskIds }, action: "updated" }] }, orderBy: { createdAt: "desc" }, take: 150, select: { createdAt: true, action: true, summary: true, changes: true, actor: { select: { name: true } } } }),
    prisma.attachment.findMany({ where: { taskId: { in: taskIds }, deletedAt: null }, select: { fileName: true, task: { select: { title: true } } }, take: 80 }),
    prisma.decision.findMany({ where: { projectId, deletedAt: null }, select: { title: true, reason: true, decidedAt: true } }),
  ]);
  const late = p.tasks.filter((t) => t.completedAt && t.dueDate && t.completedAt.getTime() > t.dueDate.getTime() + 86400000);
  const est = p.tasks.reduce((s, t) => s + (t.estimateMinutes ?? 0), 0);
  const act = p.tasks.reduce((s, t) => s + (t.actualMinutes ?? 0), 0);
  return [
    `Project: ${p.name} · status ${p.status} · owner ${p.owner?.name ?? "-"} · ${day(p.startDate)} → ${day(p.endDate)}`,
    p.description ? `Description: ${p.description}` : "",
    `Tasks: ${p.tasks.length} (done ${p.tasks.filter((t) => t.status.category === "done").length}, finished late ${late.length}) · estimate ${Math.round(est / 60)} h vs actual ${Math.round(act / 60)} h`,
    `TASKS:\n${p.tasks.map((t) => `- ${t.title} | ${t.status.name} | due ${day(t.dueDate)} | done ${day(t.completedAt)} | ${t.assignees.map((a) => a.user.name).join(", ") || "-"}`).join("\n")}`,
    `COMMENTS (latest):\n${comments.map((c) => `- [${c.task.title}] ${c.author?.name ?? "?"} (${day(c.createdAt)}): ${stripMentions(c.body).slice(0, 400)}`).join("\n") || "(none)"}`,
    `HISTORY (latest changes):\n${historyLines(history).join("\n") || "(none)"}`,
    `FILES:\n${files.map((f) => `- ${f.fileName} [${f.task?.title ?? ""}]`).join("\n") || "(none)"}`,
    `RECORDED DECISIONS:\n${decisions.map((d) => `- ${day(d.decidedAt)} ${d.title}${d.reason ? ` - ${d.reason}` : ""}`).join("\n") || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface RetroDraft {
  title: string;
  retrospective: string;
  lessons: string[];
  decisions: { title: string; reason: string; alternatives: string[] }[];
  process: string[];
  knowledgeNote: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const list = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li><p>${esc(x)}</p></li>`).join("")}</ul>` : "<p>-</p>");

/** HTML page body for a saved retrospective (plain structure, links back to the source). */
export function retroHtml(d: RetroDraft, source: { label: string; href: string }, labels: Record<"retro" | "lessons" | "decisions" | "process" | "note" | "source", string>) {
  return [
    `<p>${esc(labels.source)}: <a href="${esc(source.href)}">${esc(source.label)}</a></p>`,
    `<h2>${esc(labels.retro)}</h2>${d.retrospective.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}`,
    `<h2>${esc(labels.lessons)}</h2>${list(d.lessons)}`,
    `<h2>${esc(labels.decisions)}</h2>${list(d.decisions.map((x) => `${x.title}${x.reason ? ` - ${x.reason}` : ""}`))}`,
    `<h2>${esc(labels.process)}</h2>${d.process.length ? `<ol>${d.process.map((x) => `<li><p>${esc(x)}</p></li>`).join("")}</ol>` : "<p>-</p>"}`,
    `<h2>${esc(labels.note)}</h2>${d.knowledgeNote.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}`,
  ].join("");
}

export { htmlToText };
