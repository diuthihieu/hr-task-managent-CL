import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route } from "@/lib/authz";
import { brainAccess } from "@/lib/brain/access";
import { entityHref } from "@/lib/brain/links-core";

type P = { workspaceId: string };

/**
 * Link picker for [[ ]] and "Link to…": wiki pages (incl. meetings), tasks,
 * projects, objectives, key results, people, decisions and files the caller
 * may see, each with the href to write into the content.
 */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const types = new Set((url.searchParams.get("types") ?? "wiki,task,project,objective,kr,person,decision,file").split(","));
  const access = await brainAccess(user, workspaceId, ctx.role);
  const base = `/w/${(await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true } })).slug}`;
  const like = { contains: q, mode: "insensitive" as const };
  const n = q ? 6 : 4;
  const on = (t: string) => types.has(t);
  const [pages, tasks, projects, objectives, krs, people, decisions, files] = await Promise.all([
    on("wiki") ? prisma.wikiPage.findMany({ where: { ...access.page, ...(q ? { title: like } : {}) }, select: { id: true, title: true, wikiId: true, kind: true, status: true, wiki: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: q ? 8 : 6 }) : [],
    on("task") ? prisma.task.findMany({ where: { ...access.task, ...(q ? { title: like } : {}) }, select: { id: true, title: true, projectId: true, project: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: n }) : [],
    on("project") ? prisma.project.findMany({ where: { ...access.project, ...(q ? { name: like } : {}) }, select: { id: true, name: true }, take: n }) : [],
    on("objective") ? prisma.objective.findMany({ where: { ...access.objective, ...(q ? { title: like } : {}) }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: n }) : [],
    on("kr") ? prisma.keyResult.findMany({ where: { deletedAt: null, objective: access.objective, ...(q ? { title: like } : {}) }, select: { id: true, title: true, objectiveId: true, objective: { select: { title: true } } }, take: n }) : [],
    on("person") ? prisma.workspaceMember.findMany({ where: { workspaceId, user: { isActive: true, deletedAt: null, ...(q ? { OR: [{ name: like }, { email: like }] } : {}) } }, select: { user: { select: { id: true, name: true, email: true } } }, take: n }) : [],
    on("decision") ? prisma.decision.findMany({ where: { ...access.decision, ...(q ? { title: like } : {}) }, select: { id: true, title: true, decidedAt: true }, orderBy: { decidedAt: "desc" }, take: n }) : [],
    on("file") && q ? prisma.attachment.findMany({ where: { workspaceId, deletedAt: null, fileName: like, OR: [{ task: access.task }, { wikiPage: access.page }] }, select: { id: true, fileName: true }, take: n }) : [],
  ]);
  const items = [
    ...pages.map((p) => ({ type: "wiki", id: p.id, label: p.title || "Untitled", sub: p.wiki.name, kind: p.kind, status: p.status, href: entityHref(base, { type: "wiki", id: p.id, wikiId: p.wikiId }) })),
    ...tasks.map((t) => ({ type: "task", id: t.id, label: t.title, sub: t.project.name, href: entityHref(base, { type: "task", id: t.id, projectId: t.projectId }) })),
    ...projects.map((p) => ({ type: "project", id: p.id, label: p.name, href: entityHref(base, { type: "project", id: p.id }) })),
    ...objectives.map((o) => ({ type: "objective", id: o.id, label: o.title, href: entityHref(base, { type: "objective", id: o.id }) })),
    ...krs.map((k) => ({ type: "kr", id: k.id, label: k.title, sub: k.objective.title, href: entityHref(base, { type: "kr", id: k.id, objectiveId: k.objectiveId }) })),
    ...people.map((m) => ({ type: "person", id: m.user.id, label: m.user.name, sub: m.user.email, href: entityHref(base, { type: "person", id: m.user.id }) })),
    ...decisions.map((d) => ({ type: "decision", id: d.id, label: d.title, sub: d.decidedAt.toISOString().slice(0, 10), href: entityHref(base, { type: "decision", id: d.id }) })),
    ...files.map((f) => ({ type: "file", id: f.id, label: f.fileName, href: entityHref(base, { type: "file", id: f.id }) })),
  ];
  return NextResponse.json({ items });
});
