import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, route, notFound } from "@/lib/authz";
import { isUuid } from "@/lib/task-grid";

type P = { noteId: string };

/** Remove one of your saved notes. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { noteId } = await params;
  if (!isUuid(noteId)) throw notFound("Note");
  const n = await prisma.journalNote.deleteMany({ where: { id: noteId, userId: user.id } });
  if (!n.count) throw notFound("Note");
  return new NextResponse(null, { status: 204 });
});
