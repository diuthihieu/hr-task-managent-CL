import "server-only";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "./prisma";
import { hiddenProjectIds, visibleProjectWhere, visibleWikiWhere, type SessionUser } from "./authz";
import { visiblePageWhere } from "./wiki-sources";
import type { GraphLink, GraphLinkKind, GraphNode, KnowledgeGraph } from "./knowledge-graph-core";

export { localSubgraph } from "./knowledge-graph-core";

// Knowledge graph: a read-only view over relations that already exist in the
// database (wiki tree, links written in page/task content, task -> project /
// assignee / category / OKR / dependency / parent / files, OKR tree, wiki page
// source projects, comment mentions). Nothing is stored; every node is filtered
// by the viewer's access exactly like the lists they come from.

const MAX_TASKS = 1500;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LINK_PATTERNS: [RegExp, (m: RegExpExecArray) => string][] = [
  [new RegExp(`/wiki/${UUID}/(${UUID})`, "gi"), (m) => `wiki:${m[1].toLowerCase()}`],
  [new RegExp(`/t/(${UUID})`, "gi"), (m) => `task:${m[1].toLowerCase()}`],
  [new RegExp(`/okrs/(${UUID})`, "gi"), (m) => `objective:${m[1].toLowerCase()}`],
  [new RegExp(`/p/(${UUID})(?!/t/)`, "gi"), (m) => `project:${m[1].toLowerCase()}`],
];

/** Internal links written in rich content (href="/w/<slug>/p/<id>/t/<id>" …) -> node ids. */
export function linkedNodeIds(html: string | null | undefined): string[] {
  if (!html || !html.includes("href")) return [];
  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
  const out = new Set<string>();
  for (const href of hrefs)
    for (const [re, id] of LINK_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(href))) out.add(id(m));
    }
  return [...out];
}

export async function buildKnowledgeGraph(user: SessionUser, workspace: { id: string; slug: string }, role: WorkspaceRole): Promise<KnowledgeGraph> {
  const wsId = workspace.id;
  const base = `/w/${workspace.slug}`;
  const hidden = await hiddenProjectIds(user);
  const liveProject = { deletedAt: null, ...visibleProjectWhere(user) };

  const [projects, tasks, taskCount, objectives, pages, members] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId: wsId, ...liveProject }, select: { id: true, name: true, status: true, categories: { select: { id: true, name: true } } } }),
    prisma.task.findMany({
      where: { workspaceId: wsId, deletedAt: null, project: liveProject },
      orderBy: { updatedAt: "desc" },
      take: MAX_TASKS,
      select: {
        id: true,
        title: true,
        projectId: true,
        parentTaskId: true,
        categoryId: true,
        objectiveId: true,
        keyResultId: true,
        content: true,
        dueDate: true,
        status: { select: { name: true, category: true } },
        assignees: { select: { userId: true } },
        dependencies: { select: { dependsOnTaskId: true } },
        attachments: { where: { deletedAt: null }, select: { id: true, fileName: true } },
      },
    }),
    prisma.task.count({ where: { workspaceId: wsId, deletedAt: null, project: liveProject } }),
    prisma.objective.findMany({
      where: { workspaceId: wsId, deletedAt: null, OR: [{ projectId: null }, { project: liveProject }] },
      select: {
        id: true,
        title: true,
        status: true,
        projectId: true,
        ownerId: true,
        parentKeyResultId: true,
        contributors: { select: { userId: true } },
        keyResults: { where: { deletedAt: null }, select: { id: true, title: true, ownerId: true } },
      },
    }),
    prisma.wikiPage.findMany({
      where: { workspaceId: wsId, deletedAt: null, wiki: visibleWikiWhere(user, role), ...visiblePageWhere(hidden) },
      select: {
        id: true,
        wikiId: true,
        title: true,
        parentPageId: true,
        content: true,
        createdById: true,
        sourceProjectIds: true,
        wiki: { select: { name: true } },
        attachments: { where: { deletedAt: null }, select: { id: true, fileName: true } },
        comments: { where: { deletedAt: null }, select: { authorId: true, mentions: { select: { userId: true } } } },
      },
    }),
    prisma.workspaceMember.findMany({ where: { workspaceId: wsId, user: { isActive: true, deletedAt: null } }, select: { user: { select: { id: true, name: true, email: true } } } }),
  ]);

  const nodes = new Map<string, GraphNode>();
  const add = (n: Omit<GraphNode, "degree">) => nodes.has(n.id) || nodes.set(n.id, { ...n, degree: 0 });
  const links = new Map<string, GraphLink>();
  const pending: GraphLink[] = [];
  const link = (source: string, target: string, kind: GraphLinkKind) => source !== target && pending.push({ source, target, kind });

  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  for (const p of projects) {
    add({ id: `project:${p.id}`, type: "project", label: p.name, sub: `Project · ${p.status}`, href: `${base}/p/${p.id}` });
    for (const c of p.categories) {
      add({ id: `tag:${c.id}`, type: "tag", label: c.name, sub: `Category · ${p.name}`, href: `${base}/p/${p.id}` });
      link(`tag:${c.id}`, `project:${p.id}`, "project");
    }
  }
  const person = (id: string | null | undefined) => (id ? `person:${id}` : null);
  for (const m of members) add({ id: `person:${m.user.id}`, type: "person", label: m.user.name, sub: m.user.email });

  for (const t of tasks) {
    const id = `task:${t.id}`;
    const due = t.dueDate ? ` · ${t.dueDate.toISOString().slice(0, 10)}` : "";
    add({ id, type: "task", label: t.title, sub: `${projectName.get(t.projectId) ?? ""} · ${t.status.name}${due}`, href: `${base}/p/${t.projectId}/t/${t.id}`, done: t.status.category === "done" });
    link(id, `project:${t.projectId}`, "project");
    if (t.parentTaskId) link(id, `task:${t.parentTaskId}`, "subtask");
    if (t.categoryId) link(id, `tag:${t.categoryId}`, "tag");
    if (t.keyResultId) link(id, `kr:${t.keyResultId}`, "okr");
    else if (t.objectiveId) link(id, `objective:${t.objectiveId}`, "okr");
    for (const a of t.assignees) link(id, `person:${a.userId}`, "assignee");
    for (const d of t.dependencies) link(id, `task:${d.dependsOnTaskId}`, "depends");
    for (const f of t.attachments) {
      add({ id: `file:${f.id}`, type: "file", label: f.fileName, sub: `File · ${t.title}`, href: `/api/attachments/${f.id}/download?inline=1` });
      link(id, `file:${f.id}`, "file");
    }
    for (const target of linkedNodeIds(t.content)) link(id, target, "link");
  }

  for (const o of objectives) {
    const id = `objective:${o.id}`;
    add({ id, type: "objective", label: o.title, sub: `Objective · ${o.status}${o.projectId ? ` · ${projectName.get(o.projectId) ?? ""}` : ""}`, href: `${base}/okrs/${o.id}` });
    if (o.projectId) link(id, `project:${o.projectId}`, "project");
    const owner = person(o.ownerId);
    if (owner) link(id, owner, "owner");
    for (const c of o.contributors) link(id, `person:${c.userId}`, "contributor");
    if (o.parentKeyResultId) link(id, `kr:${o.parentKeyResultId}`, "cascade");
    for (const kr of o.keyResults) {
      add({ id: `kr:${kr.id}`, type: "kr", label: kr.title, sub: `Key result · ${o.title}`, href: `${base}/okrs/${o.id}` });
      link(`kr:${kr.id}`, id, "okr");
      const krOwner = person(kr.ownerId);
      if (krOwner) link(`kr:${kr.id}`, krOwner, "owner");
    }
  }

  for (const pg of pages) {
    const id = `wiki:${pg.id}`;
    add({ id, type: "wiki", label: pg.title || "Untitled", sub: `Wiki · ${pg.wiki.name}`, href: `${base}/wiki/${pg.wikiId}/${pg.id}` });
    if (pg.parentPageId) link(id, `wiki:${pg.parentPageId}`, "child");
    const author = person(pg.createdById);
    if (author) link(id, author, "author");
    for (const p of pg.sourceProjectIds) link(id, `project:${p}`, "source");
    for (const f of pg.attachments) {
      add({ id: `file:${f.id}`, type: "file", label: f.fileName, sub: `File · ${pg.title}`, href: `/api/attachments/${f.id}/download?inline=1` });
      link(id, `file:${f.id}`, "file");
    }
    for (const c of pg.comments) for (const m of c.mentions) link(id, `person:${m.userId}`, "mention");
    for (const target of linkedNodeIds(pg.content)) link(id, target, "link");
  }

  // Keep only links whose both ends are visible nodes (a link never reveals a hidden item), deduplicated.
  for (const l of pending) {
    if (!nodes.has(l.source) || !nodes.has(l.target)) continue;
    const key = l.source < l.target ? `${l.source}|${l.target}` : `${l.target}|${l.source}`;
    if (links.has(key)) continue;
    links.set(key, l);
    nodes.get(l.source)!.degree++;
    nodes.get(l.target)!.degree++;
  }
  // People with no relation would float around meaninglessly; drop them.
  for (const [id, n] of nodes) if (n.type === "person" && n.degree === 0) nodes.delete(id);

  return { nodes: [...nodes.values()], links: [...links.values()], truncated: taskCount > MAX_TASKS };
}
