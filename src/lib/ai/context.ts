import "server-only";
import { stripMentions } from "@/lib/mentions";
import { prisma } from "../prisma";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { visibleProjectWhere, visibleWikiWhere, hiddenProjectIds, type SessionUser } from "../authz";
import { visiblePageWhere } from "../wiki-sources";
import { resolveObjectives, OBJECTIVE_INCLUDE } from "../okr-resolver";
import { htmlToText } from "./extract";
import { isCurrentKnowledge } from "../wiki";
import { taskCommentsSection } from "./task-comments";
import { taskRef, type CitationTarget } from "./citations";

// Grounding context for the AI. Everything given to the model is read with
// the same permission filters as the rest of the app, so the model can only
// "know" what the asking user is allowed to see.

const CONTEXT_CHARS = Number(process.env.AI_CONTEXT_CHARS) || 400_000;

/** Adds sections until the character budget runs out; the rest is dropped (and noted). */
class Budget {
  private used = 0;
  private dropped = 0;
  private out: string[] = [];
  constructor(private limit: number) {}
  add(section: string) {
    if (this.used + section.length > this.limit) {
      const room = this.limit - this.used;
      if (room > 2000) {
        this.out.push(section.slice(0, room) + "\n…[truncated]");
        this.used = this.limit;
      }
      this.dropped++;
      return false;
    }
    this.out.push(section);
    this.used += section.length;
    return true;
  }
  toString() {
    return this.out.join("\n\n") + (this.dropped ? `\n\n[Note: ${this.dropped} more item(s) did not fit and were left out.]` : "");
  }
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

const hours = (minutes: number | null) => (minutes === null || minutes === undefined ? "-" : String(Math.round((minutes / 60) * 100) / 100));
const month = (d: Date | null) => (d ? d.toISOString().slice(0, 7) : "no date");

type CustomValueRow = {
  valueText: string | null;
  valueNumber: { toString(): string } | null;
  valueDate: Date | null;
  valueBool: boolean | null;
  valueOptionIds: string[];
  valueTaskIds: string[];
  option: { label: string } | null;
  user: { name: string } | null;
  customField: { name: string; type: string; options: { id: string; label: string }[] };
};
/** A custom column's value as readable text (option labels and names, not ids). */
function customValueText(v: CustomValueRow): string {
  switch (v.customField.type) {
    case "single_select":
      return v.option?.label ?? "";
    case "multi_select":
      return v.valueOptionIds.map((id) => v.customField.options.find((o) => o.id === id)?.label).filter(Boolean).join(", ");
    case "person":
      return v.user?.name ?? "";
    case "checkbox":
      return v.valueBool ? "yes" : "no";
    case "date":
      return v.valueDate ? day(v.valueDate) : "";
    case "datetime":
      return v.valueDate ? v.valueDate.toISOString().slice(0, 16).replace("T", " ") : "";
    case "link":
      return v.valueTaskIds.length ? `${v.valueTaskIds.length} linked task(s)` : "";
    default:
      if (v.valueNumber !== null) return v.valueNumber.toString();
      return (v.valueText ?? "").replace(/\s+/g, " ").slice(0, 200);
  }
}

/**
 * Estimate / actual hours per person and month (month of completion, else due date, else start date).
 * A task with several assignees counts in full for each of them; unassigned tasks are listed as "(unassigned)".
 */
export function timeSummarySection(
  tasks: { estimateMinutes: number | null; actualMinutes: number | null; completedAt: Date | null; dueDate: Date | null; startDate: Date | null; status: { category: string }; assignees: { user: { name: string } }[] }[]
): string {
  const rows = new Map<string, { person: string; month: string; tasks: number; done: number; est: number; act: number }>();
  for (const t of tasks) {
    const m = month(t.completedAt ?? t.dueDate ?? t.startDate);
    const people = t.assignees.length ? t.assignees.map((a) => a.user.name) : ["(unassigned)"];
    for (const person of people) {
      const key = `${person}\u0000${m}`;
      const r = rows.get(key) ?? { person, month: m, tasks: 0, done: 0, est: 0, act: 0 };
      r.tasks++;
      if (t.status.category === "done") r.done++;
      r.est += t.estimateMinutes ?? 0;
      r.act += t.actualMinutes ?? 0;
      rows.set(key, r);
    }
  }
  const list = [...rows.values()].sort((a, b) => a.person.localeCompare(b.person) || b.month.localeCompare(a.month));
  if (!list.length) return "## Hours per person and month\n(no tasks)";
  return (
    "## Hours per person and month (from the tasks' Estimate (h) / Actual (h); month = completed, else due, else start date; a task with several assignees counts for each)\nperson | month | tasks | done | estimate h | actual h\n" +
    list.map((r) => [r.person, r.month, r.tasks, r.done, hours(r.est), hours(r.act)].join(" | ")).join("\n")
  );
}

/** Focus time each person logged on tasks the asker can see, per month (last 12 months). */
async function focusTimeSection(o: { workspaceId: string; task: Prisma.TaskWhereInput }): Promise<string> {
  const since = new Date(Date.now() - 366 * 86_400_000);
  const sessions = await prisma.focusSession.findMany({
    where: { workspaceId: o.workspaceId, startedAt: { gte: since }, task: o.task },
    select: { startedAt: true, recordedSeconds: true, user: { select: { name: true } } },
    take: 20_000,
  });
  const rows = new Map<string, { person: string; month: string; sessions: number; seconds: number }>();
  for (const f of sessions) {
    const key = `${f.user.name}\u0000${month(f.startedAt)}`;
    const r = rows.get(key) ?? { person: f.user.name, month: month(f.startedAt), sessions: 0, seconds: 0 };
    r.sessions++;
    r.seconds += f.recordedSeconds;
    rows.set(key, r);
  }
  if (!rows.size) return "## Focus time logged\n(none in the last 12 months)";
  return (
    "## Focus time logged (focus sessions, last 12 months; these minutes are also included in the tasks' Actual (h))\nperson | month | sessions | hours\n" +
    [...rows.values()].sort((a, b) => a.person.localeCompare(b.person) || b.month.localeCompare(a.month)).map((r) => [r.person, r.month, r.sessions, hours(r.seconds / 60)].join(" | ")).join("\n")
  );
}

/** Files attached to tasks the asker can see: who / when / size, and the text read from them at upload. */
async function taskAttachmentsSection(where: Prisma.AttachmentWhereInput, opts: { maxTotalChars: number; ref: (t: { id: string; projectId: string; title: string; project: string }) => string }): Promise<string> {
  const files = await prisma.attachment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { fileName: true, contentType: true, sizeBytes: true, createdAt: true, extractedText: true, uploadedBy: { select: { name: true } }, task: { select: { id: true, projectId: true, title: true, project: { select: { name: true } } } } },
  });
  if (!files.length) return "## Task files\n(none)";
  const lines: string[] = [];
  let used = 0;
  for (const f of files) {
    if (!f.task) continue;
    const ref = opts.ref({ id: f.task.id, projectId: f.task.projectId, title: f.task.title, project: f.task.project.name });
    const head = `- ${f.fileName} | ${f.task.project.name} › ${f.task.title} [${ref}] | ${f.uploadedBy?.name ?? "-"} | ${day(f.createdAt)} | ${Math.max(1, Math.round(f.sizeBytes / 1024))} KB`;
    const text = f.extractedText ? `\n    content: ${f.extractedText.replace(/\s+/g, " ").slice(0, 1500)}` : "";
    const line = used + head.length + text.length > opts.maxTotalChars ? head : head + text;
    if (used + line.length > opts.maxTotalChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return `## Task files (${lines.length}${lines.length < files.length || files.length === 500 ? ", most recent only" : ""}; newest first)\nfile | project › task | uploaded by | date | size\n${lines.join("\n")}`;
}

/** A wiki's pages and reference documents, for its assistant. */
export async function wikiKnowledge(wikiId: string, budget = CONTEXT_CHARS, hidden: Set<string> = new Set()) {
  const pageWhere = visiblePageWhere(hidden);
  const [pages, docs, files] = await Promise.all([
    prisma.wikiPage.findMany({
      // Archived knowledge is left out; superseded / outdated pages are labelled as history.
      where: { wikiId, deletedAt: null, status: { not: "archived" }, ...pageWhere },
      orderBy: [{ parentPageId: "asc" }, { sortOrder: "asc" }],
      select: {
        title: true,
        content: true,
        updatedAt: true,
        status: true,
        version: true,
        validFrom: true,
        validTo: true,
        kind: true,
        comments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, take: 100, select: { body: true, createdAt: true, author: { select: { name: true } } } },
      },
    }),
    prisma.knowledgeDoc.findMany({ where: { wikiId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { fileName: true, text: true } }),
    // Files attached to page comments, with the text extracted at upload.
    prisma.attachment.findMany({ where: { wikiPage: { wikiId, deletedAt: null, ...pageWhere }, wikiCommentId: { not: null }, deletedAt: null, extractedText: { not: null } }, select: { fileName: true, extractedText: true, wikiPage: { select: { title: true } } } }),
  ]);
  const b = new Budget(budget);
  for (const d of docs) b.add(`### Reference document: ${d.fileName}\n${d.text}`);
  for (const p of pages) {
    const talk = p.comments.map((c) => `- ${c.author?.name ?? "?"} (${day(c.createdAt)}): ${stripMentions(c.body)}`).join("\n");
    const historical = !isCurrentKnowledge(p);
    const temporal = [p.kind !== "page" ? p.kind : "", `status ${p.status}`, p.version > 1 ? `v${p.version}` : "", p.validFrom || p.validTo ? `valid ${day(p.validFrom)} → ${day(p.validTo)}` : "", historical ? "HISTORICAL - not current" : ""].filter(Boolean).join(", ");
    b.add(`### Wiki page: ${p.title} (updated ${day(p.updatedAt)}; ${temporal})\n${htmlToText(p.content) || "(empty)"}${talk ? `\n#### Comments\n${talk}` : ""}`);
  }
  for (const f of files) b.add(`### File "${f.fileName}" (attached in a comment on "${f.wikiPage?.title ?? ""}")\n${f.extractedText}`);
  return { text: b.toString(), pageCount: pages.length, docCount: docs.length };
}

/** Everything this user may see in the workspace: projects, tasks, OKRs, wikis and docs. */
/**
 * The asker's own "Put all things on" ideas that are not tasks yet. Private to
 * their author, so only ever the caller's own (never other people's), and only
 * in projects they can still see.
 */
export async function myIdeasSection(user: SessionUser, workspaceId: string) {
  const ideas = await prisma.capturedThought.findMany({
    where: { workspaceId, userId: user.id, status: "captured", project: { deletedAt: null, ...visibleProjectWhere(user) } },
    orderBy: [{ plannedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: 200,
    select: { taskName: true, estimatedDurationMinutes: true, plannedAt: true, createdAt: true, project: { select: { name: true } }, category: { select: { name: true } } },
  });
  if (!ideas.length) return "## My captured ideas (Put all things on) - not tasks yet (0)\n(none)";
  const now = new Date();
  return (
    `## My captured ideas (Put all things on) - not tasks yet (${ideas.length}). Only the asker sees these. NOT PLANNED = no planned date; OVERDUE = planned date passed.\n` +
    "idea | project | category | duration | planned for | captured on | flag\n" +
    ideas
      .map((i) =>
        [
          i.taskName,
          i.project.name,
          i.category?.name ?? "-",
          i.estimatedDurationMinutes ? `${i.estimatedDurationMinutes} min` : "-",
          day(i.plannedAt),
          day(i.createdAt),
          !i.plannedAt ? "NOT PLANNED" : i.plannedAt < now ? "OVERDUE" : "-",
        ].join(" | ")
      )
      .join("\n")
  );
}

export async function workspaceData(user: SessionUser, workspaceId: string, role: WorkspaceRole, budget = CONTEXT_CHARS) {
  const visible = visibleProjectWhere(user);
  const [workspace, projects, tasks, objectives, hidden, members] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true } }),
    prisma.project.findMany({ where: { workspaceId, deletedAt: null, ...visible }, orderBy: { sortOrder: "asc" }, include: { owner: { select: { name: true } } } }),
    prisma.task.findMany({
      where: { workspaceId, deletedAt: null, project: { deletedAt: null, ...visible } },
      orderBy: { updatedAt: "desc" },
      take: 2000,
      select: {
        id: true,
        projectId: true,
        title: true,
        description: true,
        priority: true,
        progress: true,
        startDate: true,
        dueDate: true,
        completedAt: true,
        updatedAt: true,
        project: { select: { name: true } },
        status: { select: { name: true, category: true } },
        category: { select: { name: true } },
        assignees: { select: { user: { select: { name: true } } } },
        reportTo: { select: { user: { select: { name: true } } } },
        objective: { select: { title: true } },
        keyResult: { select: { title: true } },
        estimateMinutes: true,
        actualMinutes: true,
        importance: true,
        urgency: true,
        createdAt: true,
        recurrenceFreq: true,
        recurrenceInterval: true,
        parentTaskId: true,
        createdBy: { select: { name: true } },
        dependencies: { select: { dependsOnTaskId: true } },
        _count: { select: { comments: { where: { deletedAt: null } } } },
        attachments: { where: { deletedAt: null }, select: { fileName: true }, orderBy: { createdAt: "asc" }, take: 20 },
        customValues: {
          where: { customField: { deletedAt: null } },
          select: {
            valueText: true,
            valueNumber: true,
            valueDate: true,
            valueBool: true,
            valueOptionIds: true,
            valueTaskIds: true,
            option: { select: { label: true } },
            user: { select: { name: true } },
            customField: { select: { name: true, type: true, options: { select: { id: true, label: true } } } },
          },
        },
      },
    }),
    prisma.objective.findMany({
      where: { workspaceId, deletedAt: null, OR: [{ projectId: null }, { project: { deletedAt: null, ...visible } }] },
      include: OBJECTIVE_INCLUDE,
      orderBy: { createdAt: "asc" },
    }),
    hiddenProjectIds(user),
    prisma.workspaceMember.findMany({
      where: { workspaceId, user: { isActive: true, deletedAt: null } },
      orderBy: { user: { name: "asc" } },
      select: { role: true, createdAt: true, user: { select: { name: true, email: true, jobTitle: true, formerNames: true } } },
    }),
  ]);

  // Citation refs: the model cites [T-xxxxxxxx]; the chat route turns each into a link to the task.
  const refs = new Map<string, CitationTarget>();
  const cite = (t: { id: string; projectId: string; title: string; project: string }) => {
    const ref = taskRef(t.id);
    refs.set(ref, { url: `/w/${workspace.slug}/p/${t.projectId}/t/${t.id}`, title: `${t.project} › ${t.title}` });
    return ref;
  };

  const b = new Budget(budget);
  // Everyone in the workspace (the member list is visible to every member), not only people with tasks.
  // Former display names let the model match a question that still uses someone's old name.
  b.add(
    `## Workspace members (${members.length})\nname (current display name) | also known as (former names) | workspace role | job title | email | member since\n` +
      members.map((m) => [m.user.name, m.user.formerNames.join(", ") || "-", m.role, m.user.jobTitle || "-", m.user.email, day(m.createdAt)].join(" | ")).join("\n")
  );
  b.add(
    "## Projects\n" +
      projects.map((p) => `- ${p.name} | status: ${p.status} | owner: ${p.owner?.name ?? "-"} | ${day(p.startDate)} → ${day(p.endDate)}${p.description ? ` | ${p.description.slice(0, 300)}` : ""}`).join("\n")
  );

  const rows = resolveObjectives(objectives, hidden);
  if (rows.length)
    b.add(
      "## Objectives & key results\n" +
        rows
          .map(
            (o) =>
              `- Objective: ${o.title} | ${o.project ? `project: ${o.project.name}` : "workspace-level"} | owner: ${o.owner?.name ?? "-"} | status: ${o.status} | progress: ${Math.round(o.progress)}% | ${o.cycleLabel ?? o.cycleType} ${o.startDate ?? ""}–${o.endDate ?? ""}` +
              o.keyResults.map((k) => `\n  - KR: ${k.title} | owner: ${k.owner?.name ?? "-"} | progress: ${Math.round(k.progress)}% | ${k.currentValue}/${k.targetValue} ${k.unit ?? ""} | status: ${k.status} | ${k.tasks.length} linked task(s)`).join("")
          )
          .join("\n")
    );

  // The asker's own not-yet-planned ideas: small, and the only way to answer "what haven't I planned yet?".
  b.add(await myIdeasSection(user, workspaceId));

  // What people said on the tasks (same visibility as the task list). Added before the task list,
  // which can fill the rest of the budget, and capped so it never crowds the tasks out.
  b.add(await taskCommentsSection({ task: { workspaceId, deletedAt: null, project: { deletedAt: null, ...visible } } }, { maxChars: 1500, maxTotalChars: Math.min(80_000, Math.floor(budget * 0.2)), ref: cite }));

  const now = new Date();
  // Hours are summed here (not left to the model): per person and month, from the tasks' estimate /
  // actual hours, plus the focus time each person logged themselves.
  b.add(timeSummarySection(tasks));
  b.add(await focusTimeSection({ workspaceId, task: { deletedAt: null, project: { deletedAt: null, ...visible } } }));
  b.add(await taskAttachmentsSection({ workspaceId, deletedAt: null, task: { deletedAt: null, project: { deletedAt: null, ...visible } } }, { maxTotalChars: Math.min(60_000, Math.floor(budget * 0.15)), ref: cite }));

  const titleById = new Map(tasks.map((t) => [t.id, t]));
  const refOf = (id: string) => {
    const x = titleById.get(id);
    return x ? cite({ id: x.id, projectId: x.projectId, title: x.title, project: x.project.name }) : null;
  };
  b.add(
    `## Tasks (${tasks.length}${tasks.length === 2000 ? ", most recently updated" : ""})\nref | project | task | status | priority | progress | start | due | completed | estimate h | actual h | assignees | report to | category | objective/KR | importance/urgency | created (by) | parent task | depends on | comments | files | repeats\n` +
      tasks
        .map((t) => {
          const overdue = t.dueDate && t.dueDate < now && (t.status.category === "todo" || t.status.category === "in_progress") ? " (OVERDUE)" : "";
          return [
            cite({ id: t.id, projectId: t.projectId, title: t.title, project: t.project.name }),
            t.project.name,
            t.title,
            `${t.status.name} [${t.status.category}]`,
            t.priority ?? "-",
            `${t.progress}%`,
            day(t.startDate),
            day(t.dueDate) + overdue,
            day(t.completedAt),
            hours(t.estimateMinutes),
            hours(t.actualMinutes),
            t.assignees.map((a) => a.user.name).join(", ") || "-",
            t.reportTo.map((r) => r.user.name).join(", ") || "-",
            t.category?.name ?? "-",
            t.keyResult?.title ?? t.objective?.title ?? "-",
            `${t.importance ?? "-"}/${t.urgency ?? "-"}`,
            `${day(t.createdAt)} (${t.createdBy?.name ?? "-"})`,
            (t.parentTaskId && refOf(t.parentTaskId)) || "-",
            t.dependencies.map((d) => refOf(d.dependsOnTaskId)).filter(Boolean).join(", ") || "-",
            String(t._count.comments),
            t.attachments.length ? `${t.attachments.length}: ${t.attachments.map((a) => a.fileName).join(", ")}` : "0",
            t.recurrenceFreq ? `every ${t.recurrenceInterval ?? 1} ${t.recurrenceFreq}` : "-",
          ].join(" | ") +
            (t.customValues.length ? `\n    fields: ${t.customValues.map((v) => `${v.customField.name} = ${customValueText(v)}`).filter((x) => !x.endsWith("= ")).join("; ")}` : "") +
            (t.description ? `\n    notes: ${t.description.replace(/\s+/g, " ").slice(0, 600)}` : "");
        })
        .join("\n")
  );

  const wikis = await prisma.wiki.findMany({ where: { workspaceId, ...visibleWikiWhere(user, role) }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  for (const w of wikis) {
    const k = await wikiKnowledge(w.id, Math.max(0, budget / 4), hidden);
    if (k.pageCount || k.docCount) if (!b.add(`## Wiki "${w.name}" (pages & documents)\n${k.text}`)) break;
  }
  return { text: b.toString(), refs, projectCount: projects.length, taskCount: tasks.length, objectiveCount: rows.length };
}
