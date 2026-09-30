import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWiki, requireWorkspaceRole, route, readJson, workspaceOfTask, workspaceOfProject, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { sanitizeRichText } from "@/lib/rich-text";
import { refreshPageSources } from "@/lib/wiki-sources";
import { entityHref } from "@/lib/brain/links-core";
import { retroHtml } from "@/lib/brain/retro";
import { makeT } from "@/lib/i18n/core";
import { uuid } from "@/lib/validation";

const draftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  retrospective: z.string().max(10000),
  lessons: z.array(z.string().max(1000)).max(30),
  decisions: z.array(z.object({ title: z.string().trim().min(1).max(500), reason: z.string().max(4000).default(""), alternatives: z.array(z.string().max(500)).max(10).default([]) })).max(20),
  process: z.array(z.string().max(1000)).max(40),
  knowledgeNote: z.string().max(8000),
});

const schema = z.object({
  wikiId: uuid,
  source: z.string().regex(/^(task|project):[0-9a-f-]{36}$/),
  draft: draftSchema,
  /** Indexes of draft.decisions to also record as Decision objects. */
  saveDecisions: z.array(z.number().int().min(0)).max(20).default([]),
});

/**
 * Saves the (reviewed) retrospective as a wiki page of kind "retrospective",
 * marked AI-generated and "draft" until someone confirms it, with provenance
 * pointing at the task/project; optionally records the chosen decisions.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  const [type, id] = body.source.split(":") as ["task" | "project", string];
  const srcCtx = await requireWorkspaceRole(user, type === "task" ? await workspaceOfTask(id) : await workspaceOfProject(id), "viewer");
  const wikiCtx = await requireWiki(user, body.wikiId, "editor");
  if (wikiCtx.workspaceId !== srcCtx.workspaceId) throw badRequest("The wiki is in another workspace");
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: srcCtx.workspaceId }, select: { slug: true } });
  const base = `/w/${ws.slug}`;
  const src =
    type === "task"
      ? await prisma.task.findUniqueOrThrow({ where: { id }, select: { title: true, projectId: true } }).then((t) => ({ label: t.title, href: entityHref(base, { type: "task", id, projectId: t.projectId })!, projectId: t.projectId }))
      : await prisma.project.findUniqueOrThrow({ where: { id }, select: { name: true } }).then((p) => ({ label: p.name, href: entityHref(base, { type: "project", id })!, projectId: id }));
  const t = makeT(user.locale === "en" ? "en" : "vi");
  const html = retroHtml(body.draft, src, {
    source: t("brain.retro.source"),
    retro: t("brain.retro.retrospective"),
    lessons: t("brain.retro.lessons"),
    decisions: t("brain.retro.decisions"),
    process: t("brain.retro.process"),
    note: t("brain.retro.note"),
  });
  const result = await prisma.$transaction(async (tx) => {
    const last = await tx.wikiPage.aggregate({ where: { wikiId: body.wikiId, parentPageId: null }, _max: { sortOrder: true } });
    const page = await tx.wikiPage.create({
      data: {
        workspaceId: srcCtx.workspaceId,
        wikiId: body.wikiId,
        title: body.draft.title,
        content: sanitizeRichText(html),
        kind: "retrospective",
        status: "draft",
        sourceType: "ai_generated",
        sourceRef: body.source,
        sourceLabel: src.label,
        sourceUrl: src.href,
        confidence: "medium",
        tags: ["retrospective"],
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        createdById: user.id,
        updatedById: user.id,
      },
      select: { id: true, wikiId: true, title: true },
    });
    await refreshPageSources(tx, page.id);
    const decisionIds: string[] = [];
    for (const i of [...new Set(body.saveDecisions)]) {
      const d = body.draft.decisions[i];
      if (!d) continue;
      const created = await tx.decision.create({
        data: {
          workspaceId: srcCtx.workspaceId,
          projectId: src.projectId,
          taskId: type === "task" ? id : null,
          wikiPageId: page.id,
          title: d.title,
          reason: d.reason || null,
          alternatives: d.alternatives.map((option) => ({ option, whyNot: "" })),
          sourceType: "ai_generated",
          status: "proposed",
          createdById: user.id,
        },
        select: { id: true },
      });
      decisionIds.push(created.id);
    }
    await logActivity(tx, { workspaceId: srcCtx.workspaceId, actorId: user.id, entityType: "wiki_page", entityId: page.id, action: "created", summary: `Saved AI retrospective "${page.title}" from ${type} "${src.label}"` });
    return { page, decisionIds };
  });
  return NextResponse.json({ pageId: result.page.id, href: entityHref(base, { type: "wiki", id: result.page.id, wikiId: result.page.wikiId }), decisionIds: result.decisionIds }, { status: 201 });
});
