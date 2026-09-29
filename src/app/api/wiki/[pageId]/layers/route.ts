import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfWikiPage, forbidden, wikiRoleAtLeast } from "@/lib/authz";

type P = { pageId: string };

export interface Highlight {
  id: string;
  text: string;
  blockId?: string;
  by?: string;
  at: string;
}

function serialize(l: { highlights: unknown; keyPoints: string | null; summary: string | null; insights: string | null; generatedFrom: Date | null; generatedAt: Date | null; updatedAt: Date } | null, pageUpdatedAt: Date) {
  return {
    highlights: (Array.isArray(l?.highlights) ? l!.highlights : []) as Highlight[],
    keyPoints: l?.keyPoints ?? null,
    summary: l?.summary ?? null,
    insights: l?.insights ?? null,
    generatedAt: l?.generatedAt?.toISOString() ?? null,
    /** The page changed after the layers were generated. */
    stale: !!(l?.generatedFrom && l.generatedFrom < pageUpdatedAt),
    updatedAt: l?.updatedAt.toISOString() ?? null,
  };
}

/** Progressive summarization layers: Source (the page itself) -> Highlights -> Key points -> Summary -> Key insights. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const [layer, page] = await Promise.all([prisma.knowledgeLayer.findUnique({ where: { pageId } }), prisma.wikiPage.findUniqueOrThrow({ where: { id: pageId }, select: { updatedAt: true } })]);
  return NextResponse.json(serialize(layer, page.updatedAt));
});

const putSchema = z.object({
  /** Add one highlight (from a text selection). */
  addHighlight: z.object({ text: z.string().trim().min(1).max(2000), blockId: z.string().regex(/^[a-z0-9]{6,16}$/).optional() }).optional(),
  removeHighlight: z.string().max(40).optional(),
  keyPoints: z.string().max(20000).nullable().optional(),
  summary: z.string().max(20000).nullable().optional(),
  insights: z.string().max(20000).nullable().optional(),
  /** Set when saving an AI draft: the page version it was generated from. */
  generatedFrom: z.string().datetime({ offset: true }).optional(),
});

/** Editors change the layers; the page content (source) is never touched here. */
export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  if (!wikiRoleAtLeast(ctx.wikiRole, "editor")) throw forbidden("You can only read this wiki");
  const body = putSchema.parse(await readJson(req));
  const current = await prisma.knowledgeLayer.findUnique({ where: { pageId } });
  let highlights = (Array.isArray(current?.highlights) ? current!.highlights : []) as unknown as Highlight[];
  if (body.addHighlight) highlights = [...highlights, { id: crypto.randomUUID().slice(0, 8), text: body.addHighlight.text, blockId: body.addHighlight.blockId, by: user.name, at: new Date().toISOString() }].slice(-200);
  if (body.removeHighlight) highlights = highlights.filter((h) => h.id !== body.removeHighlight);
  const data = {
    highlights: highlights as unknown as object,
    keyPoints: body.keyPoints,
    summary: body.summary,
    insights: body.insights,
    updatedById: user.id,
    ...(body.generatedFrom ? { generatedFrom: new Date(body.generatedFrom), generatedAt: new Date() } : {}),
  };
  const layer = await prisma.knowledgeLayer.upsert({ where: { pageId }, create: { pageId, ...data }, update: data });
  const page = await prisma.wikiPage.findUniqueOrThrow({ where: { id: pageId }, select: { updatedAt: true } });
  return NextResponse.json(serialize(layer, page.updatedAt));
});
