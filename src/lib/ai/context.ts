import "server-only";
import { stripMentions } from "@/lib/mentions";
import { prisma } from "../prisma";
import type { WorkspaceRole } from "@prisma/client";
import { visibleProjectWhere, visibleWikiWhere, hiddenProjectIds, type SessionUser } from "../authz";
import { visiblePageWhere } from "../wiki-sources";
import { resolveObjectives, OBJECTIVE_INCLUDE } from "../okr-resolver";
import { htmlToText } from "./extract";

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
      where: { wikiId, deletedAt: null, ...pageWhere },
      orderBy: [{ parentPageId: "asc" }, { sortOrder: "asc" }],
      select: {
        title: true,
        content: true,
        updatedAt: true,
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
    b.add(`### Wiki page: ${p.title} (updated ${day(p.updatedAt)})\n${htmlToText(p.content) || "(empty)"}${talk ? `\n#### Comments\n${talk}` : ""}`);
  }
  for (const f of files) b.add(`### File "${f.fileName}" (attached in a comment on "${f.wikiPage?.title ?? ""}")\n${f.extractedText}`);
  return { text: b.toString(), pageCount: pages.length, docCount: docs.length };
}

/** Everything this user may see in the workspace: projects, tasks, OKRs, wikis and docs. */
export async function workspaceData(user: SessionUser, workspaceId: string, role: WorkspaceRole, budget = CONTEXT_CHARS) {
  const visible = visibleProjectWhere(user);
  const [projects, tasks, objectives, hidden] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId, deletedAt: null, ...visible }, orderBy: { sortOrder: "asc" }, include: { owner: { select: { name: true } } } }),
    prisma.task.findMany({
      where: { workspaceId, deletedAt: null, project: { deletedAt: null, ...visible } },
      orderBy: { updatedAt: "desc" },
      take: 2000,
      select: {
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
  ]);

  const b = new Budget(budget);
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

  const now = new Date();
  b.add(
    `## Tasks (${tasks.length}${tasks.length === 2000 ? ", most recently updated" : ""})\nproject | task | status | priority | progress | start | due | assignees | report to | category | objective/KR\n` +
      tasks
        .map((t) => {
          const overdue = t.dueDate && t.dueDate < now && (t.status.category === "todo" || t.status.category === "in_progress") ? " (OVERDUE)" : "";
          return [
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
          ].join(" | ") + (t.description ? `\n    notes: ${t.description.replace(/\s+/g, " ").slice(0, 240)}` : "");
        })
        .join("\n")
  );

  const wikis = await prisma.wiki.findMany({ where: { workspaceId, ...visibleWikiWhere(user, role) }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  for (const w of wikis) {
    const k = await wikiKnowledge(w.id, Math.max(0, budget / 4), hidden);
    if (k.pageCount || k.docCount) if (!b.add(`## Wiki "${w.name}" (pages & documents)\n${k.text}`)) break;
  }
  return { text: b.toString(), projectCount: projects.length, taskCount: tasks.length, objectiveCount: rows.length };
}
