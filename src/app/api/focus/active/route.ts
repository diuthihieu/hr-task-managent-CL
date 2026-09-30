import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, route } from "@/lib/authz";
import { serializeFocus, FOCUS_TASK_SELECT, FOCUS_RUNS } from "@/lib/focus";

/**
 * The caller's open focus sessions: `?all=1` lists every running and paused
 * one (running first); otherwise the running one, else the latest paused, or null.
 */
export const GET = route(async (req) => {
  const user = await requireUser();
  const all = new URL(req.url).searchParams.get("all") === "1";
  const rows = await prisma.focusSession.findMany({
    where: { userId: user.id, status: { in: ["running", "paused"] }, task: { deletedAt: null } },
    orderBy: { startedAt: "desc" },
    take: 20,
    include: { task: { select: FOCUS_TASK_SELECT }, runs: FOCUS_RUNS },
  });
  const now = new Date();
  const sorted = [...rows.filter((r) => r.status === "running"), ...rows.filter((r) => r.status !== "running")];
  if (all) return NextResponse.json(sorted.map((s) => serializeFocus(s, now)));
  return NextResponse.json(sorted[0] ? serializeFocus(sorted[0], now) : null);
});
