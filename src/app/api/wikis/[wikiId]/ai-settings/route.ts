import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWiki, route, readJson, wikiRoleAtLeast } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { aiConfigured, geminiModel } from "@/lib/ai/gemini";

type P = { wikiId: string };

/** The wiki assistant's settings. Everyone who can open the wiki reads the greeting; managers also get the instructions. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { wikiId } = await params;
  const ctx = await requireWiki(user, wikiId, "viewer");
  const manage = wikiRoleAtLeast(ctx.wikiRole, "manager");
  const [s, docs, pages] = await Promise.all([
    prisma.wikiAiSettings.findUnique({ where: { wikiId } }),
    prisma.knowledgeDoc.count({ where: { wikiId, deletedAt: null } }),
    prisma.wikiPage.count({ where: { wikiId, deletedAt: null } }),
  ]);
  return NextResponse.json({
    configured: aiConfigured(),
    model: manage ? geminiModel() : undefined,
    canManage: manage,
    enabled: s?.enabled ?? true,
    greeting: s?.greeting ?? null,
    instructions: manage ? (s?.instructions ?? "") : undefined,
    docCount: docs,
    pageCount: pages,
  });
});

const schema = z.object({
  enabled: z.boolean().optional(),
  instructions: z.string().max(20000).optional(),
  greeting: z.string().max(500).nullable().optional(),
});

export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { wikiId } = await params;
  const ctx = await requireWiki(user, wikiId, "manager");
  const body = schema.parse(await readJson(req));
  const s = await prisma.$transaction(async (tx) => {
    const s = await tx.wikiAiSettings.upsert({
      where: { wikiId },
      create: { wikiId, enabled: body.enabled ?? true, instructions: body.instructions ?? "", greeting: body.greeting ?? null, updatedById: user.id },
      update: { ...body, updatedById: user.id },
    });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki", entityId: wikiId, action: "updated", summary: "Updated the wiki AI assistant settings" });
    return s;
  });
  return NextResponse.json({ enabled: s.enabled, instructions: s.instructions, greeting: s.greeting });
});
