import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, visibleWikiWhere, wikiRoleOf } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { serializeWiki, WIKI_SELECT } from "@/lib/wiki";

type P = { workspaceId: string };

/** Wikis the caller can open, with their role in each. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  const wikis = await prisma.wiki.findMany({ where: { workspaceId, ...visibleWikiWhere(user, ctx.role) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: WIKI_SELECT });
  const rows = await Promise.all(wikis.map(async (w) => serializeWiki(w, await wikiRoleOf(user, w.id, ctx.role))));
  return NextResponse.json(rows.filter((r) => r.myRole));
});

export const wikiInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(16).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  access: z.enum(["workspace", "restricted"]).optional(),
  defaultRole: z.enum(["viewer", "editor"]).optional(),
});

/** Any member who can edit (contributor and up) can create a wiki; they manage it. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "contributor");
  const body = wikiInputSchema.parse(await readJson(req));
  const last = await prisma.wiki.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
  const wiki = await prisma.$transaction(async (tx) => {
    const w = await tx.wiki.create({
      data: { workspaceId, ...body, sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: user.id },
      select: WIKI_SELECT,
    });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "wiki", entityId: w.id, action: "created", summary: `Created wiki "${w.name}"` });
    return w;
  });
  return NextResponse.json(serializeWiki(wiki, await wikiRoleOf(user, wiki.id, ctx.role)), { status: 201 });
});
