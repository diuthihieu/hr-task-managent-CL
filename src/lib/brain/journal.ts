import "server-only";
import { prisma } from "../prisma";
import { entityHref } from "./links-core";
import type { BrainAccess } from "./access";

// Daily note / work journal. Only the user's manual notes are stored
// (journal_entries); everything else is assembled from existing data.

export interface JournalItem {
  type: "task" | "wiki" | "decision";
  id: string;
  label: string;
  sub?: string;
  href?: string;
  at?: string;
}

/** Local-day range [start, end) for a YYYY-MM-DD date and the browser's getTimezoneOffset() (minutes). */
export function dayRange(date: string, tzOffsetMinutes = 0) {
  const start = new Date(new Date(`${date}T00:00:00Z`).getTime() + tzOffsetMinutes * 60_000);
  return { start, end: new Date(start.getTime() + 86400000), dateOnly: new Date(`${date}T00:00:00Z`) };
}

export async function journalDay(access: BrainAccess, base: string, date: string, tz: number) {
  const { start, end, dateOnly } = dayRange(date, tz);
  const me = access.userId;
  const inDay = { gte: start, lt: end };
  const taskSelect = { id: true, title: true, projectId: true, completedAt: true, createdAt: true, project: { select: { name: true } } } as const;
  const [completed, created, meetings, decisions, pages, reviewed, focus, entry] = await Promise.all([
    prisma.task.findMany({ where: { ...access.task, completedAt: inDay, assignees: { some: { userId: me } } }, select: taskSelect, orderBy: { completedAt: "asc" }, take: 100 }),
    prisma.task.findMany({ where: { ...access.task, createdAt: inDay, createdById: me }, select: taskSelect, orderBy: { createdAt: "asc" }, take: 100 }),
    prisma.wikiPage.findMany({
      where: { ...access.page, kind: "meeting", OR: [{ eventDate: dateOnly }, { eventDate: null, createdAt: inDay }] },
      select: { id: true, title: true, wikiId: true, wiki: { select: { name: true } } },
      take: 50,
    }),
    prisma.decision.findMany({ where: { ...access.decision, OR: [{ decidedAt: dateOnly }, { createdAt: inDay }], AND: [{ OR: [{ createdById: me }, { people: { some: { userId: me } } }] }] }, select: { id: true, title: true, project: { select: { name: true } } }, take: 50 }),
    // Learning / notes: pages I wrote or edited that day (other than meetings).
    prisma.wikiPage.findMany({
      where: { ...access.page, kind: { not: "meeting" }, OR: [{ createdById: me, createdAt: inDay }, { updatedById: me, updatedAt: inDay }] },
      select: { id: true, title: true, wikiId: true, createdAt: true, wiki: { select: { name: true } } },
      take: 50,
    }),
    prisma.knowledgeReview.findMany({ where: { userId: me, lastReviewedAt: inDay, page: access.page }, select: { page: { select: { id: true, title: true, wikiId: true } } }, take: 50 }),
    prisma.focusSession.findMany({ where: { userId: me, workspaceId: access.workspaceId, startedAt: inDay }, select: { elapsedSeconds: true, status: true, resumedAt: true } }),
    prisma.journalEntry.findUnique({ where: { userId_workspaceId_date: { userId: me, workspaceId: access.workspaceId, date: dateOnly } } }),
  ]);
  const task = (t: (typeof completed)[number], at: Date | null): JournalItem => ({ type: "task", id: t.id, label: t.title, sub: t.project.name, href: entityHref(base, { type: "task", id: t.id, projectId: t.projectId }), at: at?.toISOString() });
  const focusMinutes = Math.round(focus.reduce((s, f) => s + f.elapsedSeconds + (f.status === "running" && f.resumedAt ? (Date.now() - f.resumedAt.getTime()) / 1000 : 0), 0) / 60);
  return {
    date,
    completed: completed.map((t) => task(t, t.completedAt)),
    created: created.map((t) => task(t, t.createdAt)),
    meetings: meetings.map((p) => ({ type: "wiki" as const, id: p.id, label: p.title, sub: p.wiki.name, href: entityHref(base, { type: "wiki", id: p.id, wikiId: p.wikiId }) })),
    decisions: decisions.map((d) => ({ type: "decision" as const, id: d.id, label: d.title, sub: d.project?.name, href: entityHref(base, { type: "decision", id: d.id }) })),
    learning: [
      ...pages.map((p) => ({ type: "wiki" as const, id: p.id, label: p.title, sub: p.wiki.name, href: entityHref(base, { type: "wiki", id: p.id, wikiId: p.wikiId }) })),
      ...reviewed.filter((r) => !pages.some((p) => p.id === r.page.id)).map((r) => ({ type: "wiki" as const, id: r.page.id, label: r.page.title, sub: "review", href: entityHref(base, { type: "wiki", id: r.page.id, wikiId: r.page.wikiId }) })),
    ],
    focusMinutes,
    notes: entry?.notes ?? null,
    aiSummary: entry?.aiSummary ?? null,
  };
}

export type JournalDay = Awaited<ReturnType<typeof journalDay>>;

/** Plain-text version of a journal day, for the AI summary. */
export function journalText(j: JournalDay, notesText: string) {
  const list = (title: string, items: JournalItem[]) => `${title} (${items.length}):\n${items.map((i) => `- ${i.label}${i.sub ? ` [${i.sub}]` : ""}`).join("\n") || "(none)"}`;
  return [
    `Date: ${j.date}`,
    `Focus time: ${j.focusMinutes} min`,
    list("WORK COMPLETED", j.completed),
    list("TASKS CREATED", j.created),
    list("MEETINGS", j.meetings),
    list("DECISIONS", j.decisions),
    list("LEARNING / NOTES WRITTEN", j.learning),
    `MY NOTES:\n${notesText || "(none)"}`,
  ].join("\n\n");
}
