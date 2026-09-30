import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfWikiPage } from "@/lib/authz";
import { REVIEW_INTERVALS_DAYS, nextReviewDate } from "@/lib/brain/review";

type P = { pageId: string };

const schema = z.object({ action: z.enum(["add", "done", "again", "remove"]) });

/** The caller's spaced-review state for this page. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const r = await prisma.knowledgeReview.findUnique({ where: { userId_pageId: { userId: user.id, pageId } } });
  return NextResponse.json(r ? { stage: r.stage, nextReviewAt: r.nextReviewAt.toISOString(), lastReviewedAt: r.lastReviewedAt?.toISOString() ?? null } : null);
});

/**
 * Spaced review: "add" schedules the first review (tomorrow); "done" moves to
 * the next interval (1, 3, 7, 14, 30, 60, 120 days); "again" restarts; "remove" stops.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const { action } = schema.parse(await readJson(req));
  const key = { userId_pageId: { userId: user.id, pageId } };
  if (action === "remove") {
    await prisma.knowledgeReview.deleteMany({ where: { userId: user.id, pageId } });
    return NextResponse.json(null);
  }
  const now = new Date();
  const current = await prisma.knowledgeReview.findUnique({ where: key });
  const stage = action === "done" && current ? Math.min(current.stage + 1, REVIEW_INTERVALS_DAYS.length - 1) : 0;
  const r = await prisma.knowledgeReview.upsert({
    where: key,
    create: { userId: user.id, pageId, stage, nextReviewAt: nextReviewDate(now, stage) },
    update: { stage, nextReviewAt: nextReviewDate(now, stage), ...(action === "add" ? {} : { lastReviewedAt: now }) },
  });
  return NextResponse.json({ stage: r.stage, nextReviewAt: r.nextReviewAt.toISOString(), lastReviewedAt: r.lastReviewedAt?.toISOString() ?? null });
});
