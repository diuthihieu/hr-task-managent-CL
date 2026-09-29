import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest } from "@/lib/authz";
import { brainAccess } from "@/lib/brain/access";
import { journalDay } from "@/lib/brain/journal";
import { sanitizeRichText } from "@/lib/rich-text";

type P = { workspaceId: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const tzOf = (v: string | null) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? n : 0;
};

/** The caller's journal for a day (?date=YYYY-MM-DD&tz=<getTimezoneOffset()>). Private to them. */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!DATE.test(date)) throw badRequest("date must be YYYY-MM-DD");
  const access = await brainAccess(user, workspaceId, ctx.role);
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true } });
  return NextResponse.json(await journalDay(access, `/w/${ws.slug}`, date, tzOf(url.searchParams.get("tz"))));
});

const putSchema = z.object({ date: z.string().regex(DATE), notes: z.string().nullable() });

/** Save the manual notes of a day. */
export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const body = putSchema.parse(await readJson(req));
  const date = new Date(`${body.date}T00:00:00Z`);
  const notes = sanitizeRichText(body.notes);
  const e = await prisma.journalEntry.upsert({
    where: { userId_workspaceId_date: { userId: user.id, workspaceId, date } },
    create: { userId: user.id, workspaceId, date, notes },
    update: { notes },
  });
  return NextResponse.json({ date: body.date, notes: e.notes, updatedAt: e.updatedAt.toISOString() });
});
