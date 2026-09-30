import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfWikiPage, badRequest } from "@/lib/authz";
import { entityHref } from "@/lib/brain/links-core";

type P = { pageId: string };

const schema = z.object({
  at: z.string().datetime({ offset: true }),
  text: z.string().max(1000).default(""),
  note: z.string().max(500).optional(),
  blockId: z.string().regex(/^[a-z0-9]{6,16}$/).optional(),
});

/**
 * "Remind me about this": a notification to yourself that stays hidden
 * (snoozed) until the chosen time, then pops up linking back to the block.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const body = schema.parse(await readJson(req));
  const at = new Date(body.at);
  if (at.getTime() < Date.now() - 60_000) throw badRequest("Pick a time in the future");
  const [page, ws] = await Promise.all([
    prisma.wikiPage.findUniqueOrThrow({ where: { id: pageId }, select: { title: true, wikiId: true } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { slug: true } }),
  ]);
  const n = await prisma.notification.create({
    data: {
      userId: user.id,
      workspaceId: ctx.workspaceId,
      type: "reminder",
      title: page.title || "Wiki",
      body: [body.note?.trim(), body.text.trim() && `“${body.text.trim().slice(0, 400)}”`].filter(Boolean).join("\n") || null,
      link: entityHref(`/w/${ws.slug}`, { type: "wiki", id: pageId, wikiId: page.wikiId, blockId: body.blockId }),
      data: { remindAt: at.toISOString() },
      snoozedUntil: at,
    },
    select: { id: true, snoozedUntil: true },
  });
  return NextResponse.json({ id: n.id, at: n.snoozedUntil!.toISOString() }, { status: 201 });
});
