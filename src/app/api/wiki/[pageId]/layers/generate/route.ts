import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfWikiPage } from "@/lib/authz";
import { htmlToText } from "@/lib/ai/extract";
import { assertAi, brainSystem, generateJson, str, strList } from "@/lib/brain/ai";

type P = { pageId: string };

export const maxDuration = 120;

/**
 * AI draft of the upper layers (key points, summary, key insights) from the
 * page and its highlights. Returns a draft only - the editor decides whether
 * to save it; the page content is never modified.
 */
export const POST = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  await assertAi(user.id);
  const [page, layer] = await Promise.all([
    prisma.wikiPage.findUniqueOrThrow({ where: { id: pageId }, select: { title: true, content: true, updatedAt: true, status: true, version: true } }),
    prisma.knowledgeLayer.findUnique({ where: { pageId }, select: { highlights: true } }),
  ]);
  const highlights = (Array.isArray(layer?.highlights) ? layer!.highlights : []) as { text?: string }[];
  const data = [
    `PAGE: ${page.title} (version ${page.version}, status ${page.status})`,
    `SOURCE:\n${htmlToText(page.content).slice(0, 60000) || "(empty)"}`,
    `HIGHLIGHTS (what readers marked as important):\n${highlights.map((h) => `- ${h.text}`).join("\n") || "(none)"}`,
  ].join("\n\n");
  const system = brainSystem({
    task: "Progressive summarization. Distil the SOURCE in layers, giving extra weight to the HIGHLIGHTS: key points (5-10 bullet sentences, each traceable to the source), a summary (one short paragraph), and key insights (2-5 non-obvious takeaways or implications for the team's work). Do not rewrite or correct the source.",
    schema: '{"keyPoints":["..."],"summary":"...","insights":["..."]}',
    locale: user.locale ?? "vi",
    data,
    responseName: "layers",
  });
  const r = await generateJson<{ keyPoints?: unknown; summary?: unknown; insights?: unknown }>(ctx.workspaceId, system);
  return NextResponse.json({
    keyPoints: strList(r.keyPoints, 12).map((k) => `- ${k}`).join("\n"),
    summary: str(r.summary, 3000),
    insights: strList(r.insights, 8).map((k) => `- ${k}`).join("\n"),
    generatedFrom: page.updatedAt.toISOString(),
  });
});
