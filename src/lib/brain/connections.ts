import "server-only";
import { prisma } from "../prisma";
import { blockIdsIn, blockTextAround, entityHref, parseContentLinks, parseHref, type EntityType } from "./links-core";
import type { BrainAccess } from "./access";

// Backlinks, unlinked mentions, outgoing links (with broken-link detection)
// and related content for a wiki page - all derived on the fly from content
// and existing relations, filtered by what the viewer may see.

export interface ResolvedEntity {
  target: string;
  type: EntityType;
  id: string;
  label: string;
  sub?: string;
  href?: string;
  /** Wiki pages: block ids present in the page (to validate block links). */
  blocks?: Set<string>;
  status?: string;
}

/** Looks up "<type>:<id>" targets the viewer may see. Missing ones are deleted, never existed, or hidden. */
export async function resolveTargets(access: BrainAccess, base: string, targets: string[], withBlocks = false): Promise<Map<string, ResolvedEntity>> {
  const ids = (type: EntityType) => [...new Set(targets.filter((t) => t.startsWith(`${type}:`)).map((t) => t.slice(type.length + 1)))];
  const [pages, tasks, projects, objectives, krs, decisions, people, files] = await Promise.all([
    ids("wiki").length ? prisma.wikiPage.findMany({ where: { ...access.page, id: { in: ids("wiki") } }, select: { id: true, title: true, wikiId: true, status: true, kind: true, content: withBlocks, wiki: { select: { name: true } } } }) : [],
    ids("task").length ? prisma.task.findMany({ where: { ...access.task, id: { in: ids("task") } }, select: { id: true, title: true, projectId: true, project: { select: { name: true } }, status: { select: { name: true } } } }) : [],
    ids("project").length ? prisma.project.findMany({ where: { ...access.project, id: { in: ids("project") } }, select: { id: true, name: true } }) : [],
    ids("objective").length ? prisma.objective.findMany({ where: { ...access.objective, id: { in: ids("objective") } }, select: { id: true, title: true } }) : [],
    ids("kr").length ? prisma.keyResult.findMany({ where: { id: { in: ids("kr") }, deletedAt: null, objective: access.objective }, select: { id: true, title: true, objectiveId: true, objective: { select: { title: true } } } }) : [],
    ids("decision").length ? prisma.decision.findMany({ where: { ...access.decision, id: { in: ids("decision") } }, select: { id: true, title: true, status: true } }) : [],
    ids("person").length ? prisma.workspaceMember.findMany({ where: { workspaceId: access.workspaceId, userId: { in: ids("person") } }, select: { user: { select: { id: true, name: true, email: true } } } }) : [],
    ids("file").length
      ? prisma.attachment.findMany({
          where: { id: { in: ids("file") }, workspaceId: access.workspaceId, deletedAt: null, OR: [{ task: access.task }, { wikiPage: access.page }] },
          select: { id: true, fileName: true },
        })
      : [],
  ]);
  const out = new Map<string, ResolvedEntity>();
  const put = (e: Omit<ResolvedEntity, "target">) => out.set(`${e.type}:${e.id}`, { ...e, target: `${e.type}:${e.id}` });
  for (const p of pages) put({ type: "wiki", id: p.id, label: p.title || "Untitled", sub: p.wiki.name, href: entityHref(base, { type: "wiki", id: p.id, wikiId: p.wikiId }), status: p.status, blocks: withBlocks ? blockIdsIn((p as { content?: string | null }).content) : undefined });
  for (const t of tasks) put({ type: "task", id: t.id, label: t.title, sub: `${t.project.name} · ${t.status.name}`, href: entityHref(base, { type: "task", id: t.id, projectId: t.projectId }) });
  for (const p of projects) put({ type: "project", id: p.id, label: p.name, href: entityHref(base, { type: "project", id: p.id }) });
  for (const o of objectives) put({ type: "objective", id: o.id, label: o.title, href: entityHref(base, { type: "objective", id: o.id }) });
  for (const k of krs) put({ type: "kr", id: k.id, label: k.title, sub: k.objective.title, href: entityHref(base, { type: "kr", id: k.id, objectiveId: k.objectiveId }) });
  for (const d of decisions) put({ type: "decision", id: d.id, label: d.title, href: entityHref(base, { type: "decision", id: d.id }), status: d.status });
  for (const m of people) put({ type: "person", id: m.user.id, label: m.user.name, sub: m.user.email, href: entityHref(base, { type: "person", id: m.user.id }) });
  for (const f of files) put({ type: "file", id: f.id, label: f.fileName, href: entityHref(base, { type: "file", id: f.id }) });
  return out;
}

export interface Mention {
  type: "wiki" | "task" | "decision";
  id: string;
  label: string;
  href?: string;
  sub?: string;
  /** Text of the block that contains the link / mention. */
  context: string;
  /** Block of *this* page the link points at (block-level backlink). */
  blockId?: string;
}

/** Every visible page / task / decision that links to `pageId`, with the linking sentence. */
export async function backlinksTo(access: BrainAccess, base: string, pageId: string): Promise<Mention[]> {
  const target = `wiki:${pageId}`;
  const [pages, tasks, decisions] = await Promise.all([
    prisma.wikiPage.findMany({ where: { ...access.page, id: { not: pageId }, content: { contains: pageId } }, select: { id: true, title: true, wikiId: true, content: true, wiki: { select: { name: true } } }, take: 100, orderBy: { updatedAt: "desc" } }),
    prisma.task.findMany({ where: { ...access.task, OR: [{ content: { contains: pageId } }, { description: { contains: pageId } }] }, select: { id: true, title: true, projectId: true, content: true, description: true, project: { select: { name: true } } }, take: 100, orderBy: { updatedAt: "desc" } }),
    prisma.decision.findMany({ where: { ...access.decision, OR: [{ wikiPageId: pageId }, { evidence: { contains: pageId } }] }, select: { id: true, title: true, reason: true, sourceBlockId: true }, take: 50, orderBy: { decidedAt: "desc" } }),
  ]);
  const out: Mention[] = [];
  const scan = (html: string | null, push: (context: string, blockId?: string) => void) => {
    if (!html) return;
    for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
      const hit = parseHref(m[1]);
      if (hit?.target === target) push(blockTextAround(html, m.index!), hit.blockId);
    }
  };
  for (const p of pages) {
    const seen = new Set<string>();
    scan(p.content, (context, blockId) => {
      if (seen.has(context)) return;
      seen.add(context);
      out.push({ type: "wiki", id: p.id, label: p.title || "Untitled", sub: p.wiki.name, href: entityHref(base, { type: "wiki", id: p.id, wikiId: p.wikiId }), context, blockId });
    });
  }
  for (const t of tasks) {
    let found = false;
    scan(t.content, (context, blockId) => {
      if (found) return;
      found = true;
      out.push({ type: "task", id: t.id, label: t.title, sub: t.project.name, href: entityHref(base, { type: "task", id: t.id, projectId: t.projectId }), context, blockId });
    });
    if (!found && t.description?.includes(pageId)) out.push({ type: "task", id: t.id, label: t.title, sub: t.project.name, href: entityHref(base, { type: "task", id: t.id, projectId: t.projectId }), context: t.description.slice(0, 240) });
  }
  for (const d of decisions) out.push({ type: "decision", id: d.id, label: d.title, href: entityHref(base, { type: "decision", id: d.id }), context: d.reason?.slice(0, 240) ?? "", blockId: d.sourceBlockId ?? undefined });
  return out;
}

/** Pages that mention the title as plain text but don't link to it yet (Obsidian's "unlinked mentions"). */
export async function unlinkedMentions(access: BrainAccess, base: string, page: { id: string; title: string }): Promise<Mention[]> {
  const title = page.title.trim();
  if (title.length < 4) return [];
  const pages = await prisma.wikiPage.findMany({
    where: { ...access.page, id: { not: page.id }, content: { contains: title, mode: "insensitive" }, NOT: { content: { contains: page.id } } },
    select: { id: true, title: true, wikiId: true, content: true, wiki: { select: { name: true } } },
    take: 20,
    orderBy: { updatedAt: "desc" },
  });
  return pages.map((p) => {
    const at = p.content!.toLowerCase().indexOf(title.toLowerCase());
    return { type: "wiki" as const, id: p.id, label: p.title, sub: p.wiki.name, href: entityHref(base, { type: "wiki", id: p.id, wikiId: p.wikiId }), context: blockTextAround(p.content!, Math.max(0, at)) };
  });
}

export interface OutgoingLink {
  target: string;
  type: EntityType;
  text: string;
  label?: string;
  href?: string;
  sub?: string;
  blockId?: string;
  /** Target gone (deleted), never existed, or not visible to the viewer. */
  broken: boolean;
  /** Block link whose block no longer exists in the target page. */
  blockMissing?: boolean;
}

export async function outgoingLinks(access: BrainAccess, base: string, html: string | null): Promise<OutgoingLink[]> {
  const links = parseContentLinks(html);
  const unique = [...new Map(links.map((l) => [`${l.target}#${l.blockId ?? ""}`, l])).values()];
  const resolved = await resolveTargets(access, base, unique.map((l) => l.target), unique.some((l) => l.blockId));
  return unique.map((l) => {
    const r = resolved.get(l.target);
    return {
      target: l.target,
      type: l.type,
      text: l.text,
      label: r?.label,
      href: r?.href ? (l.blockId && r.type === "wiki" ? `${r.href}#b-${l.blockId}` : r.href) : undefined,
      sub: r?.sub,
      blockId: l.blockId,
      broken: !r,
      blockMissing: !!(r && l.blockId && r.blocks && !r.blocks.has(l.blockId)),
    };
  });
}

export interface RelatedItem {
  type: "wiki";
  id: string;
  label: string;
  href?: string;
  sub?: string;
  score: number;
  reasons: string[];
}

const words = (s: string) => new Set(s.normalize("NFC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));

/**
 * Related pages: shared tags, links to the same tasks / projects / OKRs,
 * links between each other's neighbours, same source project, similar titles.
 */
export async function relatedPages(
  access: BrainAccess,
  base: string,
  page: { id: string; title: string; tags: string[]; content: string | null; sourceProjectIds: string[]; parentPageId: string | null },
  backlinkIds: string[]
): Promise<RelatedItem[]> {
  const outTargets = [...new Set(parseContentLinks(page.content).map((l) => l.target))].filter((t) => t !== `wiki:${page.id}`);
  const outIds = outTargets.map((t) => t.split(":")[1]).slice(0, 15);
  const linkedPages = outTargets.filter((t) => t.startsWith("wiki:")).map((t) => t.slice(5));
  const candidates = await prisma.wikiPage.findMany({
    where: {
      ...access.page,
      id: { not: page.id },
      status: { notIn: ["archived"] },
      OR: [
        ...(page.tags.length ? [{ tags: { hasSome: page.tags } }] : []),
        ...outIds.map((id) => ({ content: { contains: id } })),
        ...(page.sourceProjectIds.length ? [{ sourceProjectIds: { hasSome: page.sourceProjectIds } }] : []),
        ...(page.parentPageId ? [{ parentPageId: page.parentPageId }, { id: page.parentPageId }] : []),
        { parentPageId: page.id },
      ],
    },
    select: { id: true, title: true, wikiId: true, tags: true, content: true, sourceProjectIds: true, parentPageId: true, wiki: { select: { name: true } } },
    take: 200,
  });
  const titleWords = words(page.title);
  const out: RelatedItem[] = [];
  for (const c of candidates) {
    if (linkedPages.includes(c.id) || backlinkIds.includes(c.id)) continue; // already shown as links / backlinks
    let score = 0;
    const reasons: string[] = [];
    const sharedTags = c.tags.filter((t) => page.tags.includes(t));
    if (sharedTags.length) {
      score += 3 * sharedTags.length;
      reasons.push(`#${sharedTags.join(" #")}`);
    }
    const theirTargets = new Set(parseContentLinks(c.content).map((l) => l.target));
    const shared = outTargets.filter((t) => theirTargets.has(t));
    if (shared.length) {
      score += 2 * shared.length;
      reasons.push(`shared-links:${shared.length}`);
    }
    if (c.sourceProjectIds.some((p) => page.sourceProjectIds.includes(p))) {
      score += 1;
      reasons.push("same-project");
    }
    if (c.parentPageId === page.parentPageId && page.parentPageId) {
      score += 1;
      reasons.push("sibling");
    }
    if (c.id === page.parentPageId || c.parentPageId === page.id) {
      score += 1;
      reasons.push("parent-child");
    }
    const overlap = [...words(c.title)].filter((w) => titleWords.has(w)).length;
    if (overlap) {
      score += overlap;
      reasons.push("similar-title");
    }
    if (score > 0) out.push({ type: "wiki", id: c.id, label: c.title || "Untitled", sub: c.wiki.name, href: entityHref(base, { type: "wiki", id: c.id, wikiId: c.wikiId }), score, reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}
