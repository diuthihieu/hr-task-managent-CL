import "server-only";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "./prisma";
import { hiddenProjectIds, visibleProjectWhere, visibleWikiWhere, type SessionUser } from "./authz";
import { visiblePageWhere } from "./wiki-sources";
import type { GraphLink, GraphLinkKind, GraphNode, KnowledgeGraph } from "./knowledge-graph-core";
import { linkedTargets, normalizeTag } from "./brain/links-core";
import { brainAccess } from "./brain/access";

export { localSubgraph } from "./knowledge-graph-core";

// Knowledge graph: a read-only view over relations that already exist in the
// database (wiki tree, links written in page/task content, task -> project /
// assignee / category / OKR / dependency / parent / files, OKR tree, wiki page
// source projects and tags, comment mentions, decisions and their people). Nothing is stored; every node is filtered
// by the viewer's access exactly like the lists they come from.

const MAX_TASKS = 1500;
/** Internal links written in rich content -> node ids ("<type>:<uuid>"). */
export function linkedNodeIds(html: string | null | undefined): string[] {
  return linkedTargets(html);
}

export async function buildKnowledgeGraph(user: SessionUser, workspace: { id: string; slug: string }, role: WorkspaceRole): Promise<KnowledgeGraph> {
  const wsId = workspace.id;
  const base = `/w/${workspace.slug}`;
  const hidden = await hiddenProjectIds(user);
  const liveProject = { deletedAt: null, ...visibleProjectWhere(user) };

  const access = await brainAccess(user, wsId, role);
  const [projects, tasks, taskCount, objectives, pages, members, decisions] = await Promise.all([
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
        tags: true,
        kind: true,
        status: true,
        supersedesId: true,
        wiki: { select: { name: true } },
        attachments: { where: { deletedAt: null }, select: { id: true, fileName: true } },
        comments: { where: { deletedAt: null }, select: { authorId: true, mentions: { select: { userId: true } } } },
      },
    }),
    prisma.workspaceMember.findMany({ where: { workspaceId: wsId, user: { isActive: true, deletedAt: null } }, select: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.decision.findMany({
      where: access.decision,
      select: { id: true, title: true, status: true, decidedAt: true, projectId: true, wikiPageId: true, taskId: true, objectiveId: true, supersedesId: true, createdById: true, evidence: true, reason: true, people: { select: { userId: true } } },
      take: 1000,
    }),
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

  // Wiki tags: one node per tag name, joined to project categories of the same name.
  const categoryByTag = new Map<string, string[]>();
  for (const p of projects) for (const c of p.categories) (categoryByTag.get(normalizeTag(c.name)) ?? categoryByTag.set(normalizeTag(c.name), []).get(normalizeTag(c.name))!).push(`tag:${c.id}`);
  for (const pg of pages) {
    const id = `wiki:${pg.id}`;
    const kindLabel = pg.kind === "page" ? "Wiki" : pg.kind[0].toUpperCase() + pg.kind.slice(1);
    add({ id, type: "wiki", label: pg.title || "Untitled", sub: `${kindLabel} · ${pg.wiki.name}${pg.status !== "current" ? ` · ${pg.status}` : ""}`, href: `${base}/wiki/${pg.wikiId}/${pg.id}`, done: pg.status === "superseded" || pg.status === "archived" });
    if (pg.supersedesId) link(id, `wiki:${pg.supersedesId}`, "supersedes");
    for (const tag of pg.tags) {
      const tid = `tag:#${tag}`;
      add({ id: tid, type: "tag", label: `#${tag}`, sub: "Tag" });
      link(id, tid, "tag");
      for (const cat of categoryByTag.get(tag) ?? []) link(tid, cat, "tag");
    }
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

  for (const d of decisions) {
    const id = `decision:${d.id}`;
    add({ id, type: "decision", label: d.title, sub: `Decision · ${d.status} · ${d.decidedAt.toISOString().slice(0, 10)}`, href: `${base}/brain/decisions/${d.id}`, done: d.status === "superseded" || d.status === "revoked" });
    if (d.projectId) link(id, `project:${d.projectId}`, "project");
    if (d.wikiPageId) link(id, `wiki:${d.wikiPageId}`, "decision");
    if (d.taskId) link(id, `task:${d.taskId}`, "decision");
    if (d.objectiveId) link(id, `objective:${d.objectiveId}`, "okr");
    if (d.supersedesId) link(id, `decision:${d.supersedesId}`, "supersedes");
    for (const p of d.people) link(id, `person:${p.userId}`, "involved");
    for (const target of [...linkedNodeIds(d.evidence), ...linkedNodeIds(d.reason)]) link(id, target, "link");
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
