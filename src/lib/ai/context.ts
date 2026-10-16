import "server-only";
import { stripMentions } from "@/lib/mentions";
import { prisma } from "../prisma";
import type { WorkspaceRole } from "@prisma/client";
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
  b.add(
    `## Tasks (${tasks.length}${tasks.length === 2000 ? ", most recently updated" : ""})\nref | project | task | status | priority | progress | start | due | assignees | report to | category | objective/KR\n` +
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
            t.assignees.map((a) => a.user.name).join(", ") || "-",
            t.reportTo.map((r) => r.user.name).join(", ") || "-",
            t.category?.name ?? "-",
            t.keyResult?.title ?? t.objective?.title ?? "-",
          ].join(" | ") + (t.description ? `\n    notes: ${t.description.replace(/\s+/g, " ").slice(0, 600)}` : "");
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
