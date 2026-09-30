import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, visibleProjectWhere, visibleWikiWhere, hiddenProjectIds } from "@/lib/authz";
import { visiblePageWhere } from "@/lib/wiki-sources";
import { brainAccess } from "@/lib/brain/access";
import { normalizeTag } from "@/lib/brain/links-core";

const EMPTY = { projects: [], tasks: [], pages: [], objectives: [], people: [], files: [], decisions: [] };

/**
 * Universal search (Ctrl/Cmd+K): tasks, projects, wiki pages, objectives,
 * people and files, case-insensitive, in SQL. Every entity is filtered by
 * what the caller may see (hidden projects, private wikis).
 */
export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!q || !workspaceId) return NextResponse.json(EMPTY);
  const { role } = await requireWorkspaceRole(user, workspaceId, "viewer");
  const like = { contains: q, mode: "insensitive" as const };
  const visible = visibleProjectWhere(user);
  const liveProject = { deletedAt: null, ...visible };
  const wikiWhere = visibleWikiWhere(user, role);
  const pageWhere = visiblePageWhere(await hiddenProjectIds(user));
  const access = await brainAccess(user, workspaceId, role);
  // "#tag" searches wiki pages by tag.
  const tag = q.startsWith("#") ? normalizeTag(q) : null;

  const [projects, tasks, pages, objectives, people, files, decisions] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId, ...liveProject, name: like }, select: { id: true, name: true, color: true }, take: 6 }),
    prisma.task.findMany({
      where: { workspaceId, deletedAt: null, project: liveProject, OR: [{ title: like }, { description: like }] },
      select: { id: true, title: true, project: { select: { id: true, name: true } }, status: { select: { name: true, color: true } } },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
    prisma.wikiPage.findMany({
      where: { workspaceId, deletedAt: null, wiki: wikiWhere, ...pageWhere, ...(tag ? { tags: { has: tag } } : { OR: [{ title: like }, { tags: { has: normalizeTag(q) } }] }) },
      select: { id: true, title: true, wikiId: true, kind: true, status: true, wiki: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.objective.findMany({
      where: { workspaceId, deletedAt: null, OR: [{ projectId: null }, { project: liveProject }], AND: [{ OR: [{ title: like }, { keyResults: { some: { deletedAt: null, title: like } } }] }] },
      select: { id: true, title: true, project: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId, user: { isActive: true, OR: [{ name: like }, { email: like }] } },
      select: { role: true, user: { select: { id: true, name: true, email: true, avatarColor: true } } },
      take: 6,
    }),
    prisma.attachment.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        fileName: like,
        OR: [{ task: { deletedAt: null, project: liveProject } }, { wikiPage: { deletedAt: null, wiki: wikiWhere, ...pageWhere } }],
      },
      select: { id: true, fileName: true, contentType: true, sizeBytes: true, task: { select: { id: true, title: true, projectId: true } }, wikiPage: { select: { id: true, title: true, wikiId: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.decision.findMany({
      where: { ...access.decision, OR: [{ title: like }, { reason: like }] },
      select: { id: true, title: true, status: true, decidedAt: true, project: { select: { name: true } } },
      orderBy: { decidedAt: "desc" },
      take: 6,
    }),
  ]);

  return NextResponse.json({
    projects,
    tasks: tasks.map((t) => ({ id: t.id, label: t.title, projectId: t.project.id, projectName: t.project.name, status: t.status.name, statusColor: t.status.color })),
    pages: pages.map((p) => ({ id: p.id, label: p.title, wikiId: p.wikiId, wikiName: p.wiki.name, kind: p.kind, status: p.status })),
    decisions: decisions.map((d) => ({ id: d.id, label: d.title, status: d.status, decidedAt: d.decidedAt.toISOString().slice(0, 10), projectName: d.project?.name ?? null })),
    objectives: objectives.map((o) => ({ id: o.id, label: o.title, projectName: o.project?.name ?? null })),
    people: people.map((m) => ({ ...m.user, role: m.role })),
    files: files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      contentType: f.contentType,
      sizeBytes: f.sizeBytes,
      parent: f.task ? { kind: "task" as const, id: f.task.id, label: f.task.title, projectId: f.task.projectId } : f.wikiPage ? { kind: "wiki" as const, id: f.wikiPage.id, label: f.wikiPage.title, wikiId: f.wikiPage.wikiId } : null,
    })),
  });
});
