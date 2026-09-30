import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest } from "@/lib/authz";
import { sanitizeRichText } from "@/lib/rich-text";
import { htmlToText } from "@/lib/ai/extract";

type P = { workspaceId: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const serialize = (n: { id: string; date: Date; title: string; content: string; createdAt: Date }) => ({ id: n.id, date: n.date.toISOString().slice(0, 10), title: n.title, content: n.content, createdAt: n.createdAt.toISOString() });

/** The caller's saved journal notes, newest first (?date=YYYY-MM-DD for one day, ?q= to search). Private to them. */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  if (date && !DATE.test(date)) throw badRequest("date must be YYYY-MM-DD");
  const q = url.searchParams.get("q")?.trim().slice(0, 100);
  const rows = await prisma.journalNote.findMany({
    where: { workspaceId, userId: user.id, ...(date ? { date: new Date(`${date}T00:00:00Z`) } : {}), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json(rows.map(serialize));
});

const schema = z.object({ date: z.string().regex(DATE), content: z.string().max(200_000), title: z.string().trim().max(200).optional() });

/** Save the current note into the history. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const body = schema.parse(await readJson(req));
  const content = sanitizeRichText(body.content) ?? "";
  const text = htmlToText(content).replace(/\s+/g, " ").trim();
  if (!text && !/<img/i.test(content)) throw badRequest("The note is empty");
  const title = body.title || text.slice(0, 80) || "Note";
  const n = await prisma.journalNote.create({ data: { workspaceId, userId: user.id, date: new Date(`${body.date}T00:00:00Z`), title, content } });
  return NextResponse.json(serialize(n), { status: 201 });
});
