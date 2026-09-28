import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, route } from "@/lib/authz";
import { serializeFocus, FOCUS_TASK_SELECT } from "@/lib/focus";

/** The caller's running or paused focus session (at most one), or null. */
export const GET = route(async () => {
  const user = await requireUser();
  const s = await prisma.focusSession.findFirst({
    where: { userId: user.id, status: { in: ["running", "paused"] }, task: { deletedAt: null } },
    orderBy: { startedAt: "desc" },
    include: { task: { select: FOCUS_TASK_SELECT } },
  });
  return NextResponse.json(s ? serializeFocus(s) : null);
});
