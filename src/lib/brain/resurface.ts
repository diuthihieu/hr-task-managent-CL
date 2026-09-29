import "server-only";
import { prisma } from "../prisma";
import { entityHref, normalizeTag, parseContentLinks } from "./links-core";
import type { BrainAccess } from "./access";
import { badRequest } from "../http-errors";

// Knowledge resurfacing: bring old knowledge back when it matters -
// related to the work in front of you, due for spaced review, or worth
// rediscovering. Read-only; computed from existing data.

export interface Resurfaced {
  id: string;
  title: string;
  href?: string;
  sub?: string;
  /** Why it is shown: task titles it relates to, review stage, … */
  because: string[];
  score?: number;
  nextReviewAt?: string;
  stage?: number;
}

export interface Attention {
  kind: "stale_linked" | "decision_review" | "review_due" | "draft_to_confirm";
  id: string;
  title: string;
  href?: string;
  /** The task that relies on it, the review date, the review round… */
  detail: string;
  extra?: { title: string; href?: string };
}
export interface Insight {
  kind: "tasks_without_knowledge" | "knowledge_for_work" | "stale_knowledge" | "recent_decisions" | "decision_review" | "review_due";
  n: number;
  total?: number;
  title?: string;
  href?: string;
  detail?: string;
}

const LIVE = { status: { notIn: ["archived" as const, "superseded" as const] } };

/** Stable per-day pseudo-random order (so "rediscover" changes daily, not on every refresh). */
function dailyRank(id: string, day: string) {
  let h = 2166136261;
  for (const c of id + day) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export async function forYou(access: BrainAccess, base: string, now = new Date()) {
  const me = access.userId;
  const soon = new Date(now.getTime() + 45 * 86400000);
  const myTasks = await prisma.task.findMany({
    where: { ...access.task, assignees: { some: { userId: me } }, status: { category: { in: ["todo", "in_progress"] } }, OR: [{ dueDate: { lte: soon } }, { dueDate: null, updatedAt: { gte: new Date(now.getTime() - 14 * 86400000) } }] },
    select: { id: true, title: true, projectId: true, keyResultId: true, objectiveId: true, content: true, category: { select: { name: true } } },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
    take: 25,
  });
  // Pages that link to my current tasks / their KR, objective or project, or share a tag with the task's category.
  const why = new Map<string, { title: string; weight: number }[]>();
  for (const t of myTasks) {
    for (const [id, w] of [[t.id, 3], [t.keyResultId, 2], [t.objectiveId, 2], [t.projectId, 1]] as [string | null, number][]) if (id) (why.get(id) ?? why.set(id, []).get(id)!).push({ title: t.title, weight: w });
  }
  // Pages my tasks link to (e.g. the page a task was created from).
  const linkedFromTasks = new Map<string, string[]>();
  for (const t of myTasks) for (const l of parseContentLinks(t.content)) if (l.type === "wiki") (linkedFromTasks.get(l.id) ?? linkedFromTasks.set(l.id, []).get(l.id)!).push(t.title);
  const tags = [...new Set(myTasks.map((t) => t.category?.name).filter((x): x is string => !!x).map(normalizeTag))];
  const ids = [...why.keys()].slice(0, 40);
  const candidates = ids.length || tags.length || linkedFromTasks.size
    ? await prisma.wikiPage.findMany({
        where: { ...access.page, ...LIVE, OR: [...(linkedFromTasks.size ? [{ id: { in: [...linkedFromTasks.keys()] } }] : []), ...ids.map((id) => ({ content: { contains: id } })), ...(tags.length ? [{ tags: { hasSome: tags } }] : []), ...(myTasks.length ? [{ sourceProjectIds: { hasSome: [...new Set(myTasks.map((t) => t.projectId))] } }] : [])] },
        select: { id: true, title: true, wikiId: true, content: true, tags: true, sourceProjectIds: true, wiki: { select: { name: true } } },
        take: 150,
      })
    : [];
  const related: Resurfaced[] = [];
  for (const p of candidates) {
    const targets = new Set(parseContentLinks(p.content).map((l) => l.id));
    let score = 0;
    const because = new Set<string>();
    for (const [id, refs] of why) if (targets.has(id)) for (const r of refs) {
      score += r.weight;
      because.add(r.title);
    }
    for (const title of linkedFromTasks.get(p.id) ?? []) {
      score += 3;
      because.add(title);
    }
    for (const t of myTasks) {
      if (t.category && p.tags.includes(normalizeTag(t.category.name))) {
        score += 1;
        because.add(t.title);
      }
      if (p.sourceProjectIds.includes(t.projectId)) score += 0.5;
    }
    if (score > 0) related.push({ id: p.id, title: p.title, sub: p.wiki.name, href: entityHref(base, { type: "wiki", id: p.id, wikiId: p.wikiId }), because: [...because].slice(0, 3), score });
  }
  related.sort((a, b) => b.score! - a.score!);

  const [due, old, decisions] = await Promise.all([
    prisma.knowledgeReview.findMany({ where: { userId: me, nextReviewAt: { lte: now }, page: access.page }, select: { stage: true, nextReviewAt: true, page: { select: { id: true, title: true, wikiId: true, wiki: { select: { name: true } } } } }, orderBy: { nextReviewAt: "asc" }, take: 10 }),
    prisma.wikiPage.findMany({
      where: { ...access.page, ...LIVE, updatedAt: { lt: new Date(now.getTime() - 45 * 86400000) }, OR: [{ lastViewedAt: null }, { lastViewedAt: { lt: new Date(now.getTime() - 30 * 86400000) } }] },
      select: { id: true, title: true, wikiId: true, updatedAt: true, wiki: { select: { name: true } } },
      take: 300,
    }),
    prisma.decision.findMany({
      where: { ...access.decision, status: { in: ["active", "proposed"] }, decidedAt: { gte: new Date(now.getTime() - 14 * 86400000) }, OR: [{ people: { some: { userId: me } } }, { projectId: { in: [...new Set(myTasks.map((t) => t.projectId))] } }] },
      select: { id: true, title: true, decidedAt: true, project: { select: { name: true } } },
      orderBy: { decidedAt: "desc" },
      take: 5,
    }),
  ]);
  const today = now.toISOString().slice(0, 10);
  // --- Needs attention: things that are wrong or due, each with why it matters and what to do.
  const linkedPageIds = [...new Set([...linkedFromTasks.keys()])];
  const [reviewDecisions, staleLinked, myDrafts, myTasksWithoutKnowledge, activity] = await Promise.all([
    prisma.decision.findMany({
      where: { ...access.decision, status: { in: ["active", "proposed"] }, reviewDate: { lte: new Date(today) }, OR: [{ ownerId: me }, { createdById: me }, { people: { some: { userId: me } } }] },
      select: { id: true, title: true, reviewDate: true },
      orderBy: { reviewDate: "asc" },
      take: 5,
    }),
    linkedPageIds.length
      ? prisma.wikiPage.findMany({ where: { ...access.page, id: { in: linkedPageIds }, OR: [{ status: { in: ["outdated", "superseded"] } }, { validTo: { lt: new Date(today) } }] }, select: { id: true, title: true, wikiId: true, status: true, supersededBy: { select: { id: true, title: true } } }, take: 5 })
      : [],
    prisma.wikiPage.findMany({ where: { ...access.page, createdById: me, status: "draft", sourceType: "ai_generated" }, select: { id: true, title: true, wikiId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 3 }),
    Promise.resolve(myTasks.filter((t) => !related.some((r) => r.because.includes(t.title)) && !parseContentLinks(t.content).some((l) => l.type === "wiki")).length),
    prisma.wikiPage.findMany({
      where: { ...access.page, updatedAt: { gte: new Date(now.getTime() - 7 * 86400000) }, NOT: { updatedById: me } },
      select: { id: true, title: true, wikiId: true, kind: true, updatedAt: true, createdAt: true, updatedBy: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
  ]);
  const page = (p: { id: string; wikiId: string }) => entityHref(base, { type: "wiki", id: p.id, wikiId: p.wikiId });
  const needsAttention: Attention[] = [
    ...staleLinked.map((p) => ({ kind: "stale_linked" as const, id: p.id, title: p.title, href: page(p), detail: linkedFromTasks.get(p.id)?.[0] ?? "", extra: p.supersededBy ? { title: p.supersededBy.title, href: entityHref(base, { type: "wiki", id: p.supersededBy.id, wikiId: p.wikiId }) } : undefined })),
    ...reviewDecisions.map((d) => ({ kind: "decision_review" as const, id: d.id, title: d.title, href: entityHref(base, { type: "decision", id: d.id }), detail: d.reviewDate!.toISOString().slice(0, 10) })),
    ...due.slice(0, 5).map((r) => ({ kind: "review_due" as const, id: r.page.id, title: r.page.title, href: page(r.page), detail: String(r.stage + 1) })),
    ...myDrafts.map((p) => ({ kind: "draft_to_confirm" as const, id: p.id, title: p.title, href: page(p), detail: p.createdAt.toISOString().slice(0, 10) })),
  ];

  // --- Rule-based insights (no AI needed, always available).
  const insights: Insight[] = [];
  if (myTasks.length && myTasksWithoutKnowledge) insights.push({ kind: "tasks_without_knowledge", n: myTasksWithoutKnowledge, total: myTasks.length });
  if (related.length) insights.push({ kind: "knowledge_for_work", n: related.length, title: related[0].title, href: related[0].href });
  if (staleLinked.length) insights.push({ kind: "stale_knowledge", n: staleLinked.length });
  if (decisions.length) insights.push({ kind: "recent_decisions", n: decisions.length });
  const hero: Insight | null =
    staleLinked.length ? { kind: "stale_knowledge", n: staleLinked.length, title: staleLinked[0].title, href: page(staleLinked[0]) }
    : reviewDecisions.length ? { kind: "decision_review", n: reviewDecisions.length, title: reviewDecisions[0].title, href: entityHref(base, { type: "decision", id: reviewDecisions[0].id }) }
    : related.length ? { kind: "knowledge_for_work", n: related.length, title: related[0].title, href: related[0].href, detail: related[0].because[0] }
    : due.length ? { kind: "review_due", n: due.length, title: due[0].page.title, href: page(due[0].page) }
    : myTasks.length ? { kind: "tasks_without_knowledge", n: myTasksWithoutKnowledge, total: myTasks.length }
    : null;

  return {
    hero,
    needsAttention,
    insights,
    activity: activity.map((p) => ({ id: p.id, title: p.title, href: page(p), kind: p.kind, by: p.updatedBy?.name ?? null, at: p.updatedAt.toISOString(), created: p.createdAt.getTime() > now.getTime() - 7 * 86400000 && Math.abs(p.createdAt.getTime() - p.updatedAt.getTime()) < 60_000 })),
    myTasks: myTasks.slice(0, 8).map((t) => ({ id: t.id, title: t.title })),
    relatedToWork: related.slice(0, 8),
    dueForReview: due.map((r) => ({ id: r.page.id, title: r.page.title, sub: r.page.wiki.name, href: entityHref(base, { type: "wiki", id: r.page.id, wikiId: r.page.wikiId }), because: [], stage: r.stage, nextReviewAt: r.nextReviewAt.toISOString() })),
    rediscover: old
      .filter((p) => !related.some((r) => r.id === p.id))
      .sort((a, b) => dailyRank(a.id, today) - dailyRank(b.id, today))
      .slice(0, 3)
      .map((p) => ({ id: p.id, title: p.title, sub: p.wiki.name, href: entityHref(base, { type: "wiki", id: p.id, wikiId: p.wikiId }), because: [p.updatedAt.toISOString().slice(0, 10)] })),
    recentDecisions: decisions.map((d) => ({ id: d.id, title: d.title, sub: d.project?.name, href: entityHref(base, { type: "decision", id: d.id }), because: [d.decidedAt.toISOString().slice(0, 10)] })),
    myTaskCount: myTasks.length,
  };
}

/** Weekly Brain Review data: what was learned, decided and done in the week starting `weekStart` (UTC). */
export async function weeklyReview(access: BrainAccess, base: string, weekStart: Date) {
  const end = new Date(weekStart.getTime() + 7 * 86400000);
  const inWeek = { gte: weekStart, lt: end };
  const me = access.userId;
  const monthAgo = new Date(end.getTime() - 30 * 86400000);
  const [created, updated, meetings, decisions, completed, reviewsDue, journal, openTasks, proposed, drafts, repeated] = await Promise.all([
    prisma.wikiPage.findMany({ where: { ...access.page, createdAt: inWeek }, select: { id: true, title: true, wikiId: true, kind: true, createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.wikiPage.findMany({ where: { ...access.page, createdAt: { lt: weekStart }, updatedAt: inWeek }, select: { id: true, title: true, wikiId: true, updatedBy: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.wikiPage.findMany({ where: { ...access.page, kind: "meeting", OR: [{ eventDate: inWeek }, { eventDate: null, createdAt: inWeek }] }, select: { id: true, title: true, wikiId: true }, take: 30 }),
    prisma.decision.findMany({ where: { ...access.decision, OR: [{ decidedAt: inWeek }, { createdAt: inWeek }] }, select: { id: true, title: true, status: true, project: { select: { name: true } } }, orderBy: { decidedAt: "desc" }, take: 50 }),
    prisma.task.findMany({ where: { ...access.task, completedAt: inWeek, assignees: { some: { userId: me } } }, select: { id: true, title: true, projectId: true, project: { select: { name: true } } }, take: 100 }),
    prisma.knowledgeReview.count({ where: { userId: me, nextReviewAt: { lte: end }, page: access.page } }),
    prisma.journalEntry.findMany({ where: { userId: me, workspaceId: access.workspaceId, date: inWeek }, select: { date: true, notes: true, aiSummary: true }, orderBy: { date: "asc" } }),
    // Open loops: my unfinished work that is overdue or due within a week of the review.
    prisma.task.findMany({ where: { ...access.task, assignees: { some: { userId: me } }, status: { category: { in: ["todo", "in_progress"] } }, dueDate: { lt: new Date(end.getTime() + 7 * 86400000) } }, select: { id: true, title: true, projectId: true, dueDate: true, project: { select: { name: true } } }, orderBy: { dueDate: "asc" }, take: 20 }),
    prisma.decision.findMany({ where: { ...access.decision, status: "proposed", OR: [{ ownerId: me }, { createdById: me }] }, select: { id: true, title: true }, take: 10 }),
    prisma.wikiPage.findMany({ where: { ...access.page, createdById: me, status: "draft" }, select: { id: true, title: true, wikiId: true }, take: 10 }),
    // Automation opportunities: the same task done by hand again and again (not set to repeat).
    prisma.task.findMany({ where: { ...access.task, completedAt: { gte: monthAgo, lt: end }, assignees: { some: { userId: me } }, recurrenceFreq: null }, select: { title: true }, take: 500 }),
  ]);
  const byTitle = new Map<string, { title: string; n: number }>();
  for (const t of repeated) {
    const k = t.title.normalize("NFC").toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
    const e = byTitle.get(k) ?? byTitle.set(k, { title: t.title, n: 0 }).get(k)!;
    e.n++;
  }
  const automation = [...byTitle.values()].filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 5).map((x) => ({ kind: "recurring" as const, title: x.title, n: x.n }));
  const page = (p: { id: string; title: string; wikiId: string }) => ({ id: p.id, title: p.title, href: entityHref(base, { type: "wiki", id: p.id, wikiId: p.wikiId }) });
  return {
    weekStart: weekStart.toISOString().slice(0, 10),
    newKnowledge: created.map((p) => ({ ...page(p), kind: p.kind, by: p.createdBy?.name ?? null })),
    updatedKnowledge: updated.map((p) => ({ ...page(p), by: p.updatedBy?.name ?? null })),
    meetings: meetings.map(page),
    decisions: decisions.map((d) => ({ id: d.id, title: d.title, status: d.status, project: d.project?.name ?? null, href: entityHref(base, { type: "decision", id: d.id }) })),
    completed: completed.map((t) => ({ id: t.id, title: t.title, project: t.project.name, href: entityHref(base, { type: "task", id: t.id, projectId: t.projectId }) })),
    reviewsDue,
    journalDays: journal.map((j) => ({ date: j.date.toISOString().slice(0, 10), hasNotes: !!j.notes, aiSummary: j.aiSummary })),
    openLoops: [
      ...openTasks.map((t) => ({ kind: t.dueDate && t.dueDate < weekStart ? ("overdue" as const) : ("due" as const), id: t.id, title: t.title, sub: `${t.project.name}${t.dueDate ? ` · ${t.dueDate.toISOString().slice(0, 10)}` : ""}`, href: entityHref(base, { type: "task", id: t.id, projectId: t.projectId }) })),
      ...proposed.map((d) => ({ kind: "proposed_decision" as const, id: d.id, title: d.title, href: entityHref(base, { type: "decision", id: d.id }) })),
      ...drafts.map((p) => ({ kind: "draft" as const, ...page(p) })),
    ],
    automation,
  };
}

/** Monday (UTC) of the week containing `raw` (YYYY-MM-DD) or today. */
export function weekStartOf(raw: string | null): Date {
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw badRequest("week must be YYYY-MM-DD");
  const d = raw ? new Date(`${raw}T00:00:00Z`) : new Date(new Date().toISOString().slice(0, 10));
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dow * 86400000);
}

