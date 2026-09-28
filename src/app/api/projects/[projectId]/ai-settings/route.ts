import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, assertCanManageProject } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { aiConfigured, geminiModel } from "@/lib/ai/gemini";

type P = { projectId: string };

async function canManage(ctx: Awaited<ReturnType<typeof requireWorkspaceRole>>, projectId: string) {
  try {
    await assertCanManageProject(ctx, projectId);
    return true;
  } catch {
    return false;
  }
}

/** The wiki assistant's settings. Everyone who can see the project reads the greeting; managers also get the instructions. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  const [s, manage, docs, pages] = await Promise.all([
    prisma.projectAiSettings.findUnique({ where: { projectId } }),
    canManage(ctx, projectId),
    prisma.knowledgeDoc.count({ where: { projectId, deletedAt: null } }),
    prisma.wikiPage.count({ where: { projectId, deletedAt: null } }),
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
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  await assertCanManageProject(ctx, projectId);
  const body = schema.parse(await readJson(req));
  const s = await prisma.$transaction(async (tx) => {
    const s = await tx.projectAiSettings.upsert({
      where: { projectId },
      create: { projectId, enabled: body.enabled ?? true, instructions: body.instructions ?? "", greeting: body.greeting ?? null, updatedById: user.id },
      update: { ...body, updatedById: user.id },
    });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "project", entityId: projectId, action: "updated", summary: "Updated the wiki AI assistant settings" });
    return s;
  });
  return NextResponse.json({ enabled: s.enabled, instructions: s.instructions, greeting: s.greeting });
});
