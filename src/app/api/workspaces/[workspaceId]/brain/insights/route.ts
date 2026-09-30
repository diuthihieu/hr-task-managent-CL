import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/authz";
import { brainContext } from "@/lib/brain/route-helpers";
import { forYou } from "@/lib/brain/resurface";
import { assertAi, brainSystem, generateJson, str } from "@/lib/brain/ai";

type P = { workspaceId: string };

export const maxDuration = 60;

/**
 * AI insights for the day: connects the caller's current work with what the
 * brain knows (related pages, stale knowledge, decisions to review) and
 * proposes concrete next actions. Suggestions only; nothing is changed.
 */
export const POST = route<P>(async (_req, { params }) => {
  const { workspaceId } = await params;
  const { user, access, base } = await brainContext(workspaceId);
  await assertAi(user.id);
  const f = await forYou(access, base);
  const tasks = await prisma.task.findMany({
    where: { id: { in: f.myTasks.map((t) => t.id) } },
    select: { title: true, dueDate: true, status: { select: { name: true } }, project: { select: { name: true } } },
  });
  const data = [
    `MY OPEN TASKS:\n${tasks.map((t) => `- ${t.title} [${t.project.name}] ${t.status.name}${t.dueDate ? ` due ${t.dueDate.toISOString().slice(0, 10)}` : ""}`).join("\n") || "(none)"}`,
    `KNOWLEDGE RELATED TO THEM:\n${f.relatedToWork.map((r) => `- "${r.title}" (relates to: ${r.because.join(", ")})`).join("\n") || "(none)"}`,
    `NEEDS ATTENTION:\n${f.needsAttention.map((a) => `- ${a.kind}: "${a.title}" ${a.detail}`).join("\n") || "(none)"}`,
    `RECENT DECISIONS:\n${f.recentDecisions.map((d) => `- "${d.title}"`).join("\n") || "(none)"}`,
    `RECENTLY CHANGED KNOWLEDGE:\n${f.activity.map((a) => `- "${a.title}" by ${a.by ?? "?"}`).join("\n") || "(none)"}`,
  ].join("\n\n");
  const system = brainSystem({
    task: "Give the user 3 short, specific insights for today that connect their open work with the team's knowledge and decisions (e.g. a page to read before a task, knowledge that looks outdated, a decision that affects a task, missing documentation). Each has a title (max 10 words), one sentence of detail, and a concrete next action. Only from the DATA; skip generic advice.",
    schema: '{"insights":[{"title":"...","detail":"...","action":"..."}]}',
    locale: user.locale ?? "vi",
    data,
    responseName: "insights",
  });
  const r = await generateJson<{ insights?: { title?: unknown; detail?: unknown; action?: unknown }[] }>(workspaceId, system);
  const insights = (Array.isArray(r.insights) ? r.insights : []).map((i) => ({ title: str(i.title, 160), detail: str(i.detail, 500), action: str(i.action, 300) })).filter((i) => i.title).slice(0, 5);
  return NextResponse.json({ insights });
});
