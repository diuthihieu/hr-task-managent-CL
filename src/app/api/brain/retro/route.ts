import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfTask, workspaceOfProject, badRequest } from "@/lib/authz";
import { assertAi, brainSystem, generateJson, str, strList } from "@/lib/brain/ai";
import { projectRetroContext, taskRetroContext, type RetroDraft } from "@/lib/brain/retro";
import { uuid } from "@/lib/validation";

export const maxDuration = 120;

const schema = z.object({ taskId: uuid.optional(), projectId: uuid.optional() }).refine((b) => !!b.taskId !== !!b.projectId, "Send taskId or projectId");

/**
 * AI draft of a retrospective for a finished task or project: retrospective,
 * lessons learned, key decisions, a reusable process and a knowledge note -
 * from its status/date history, comments, files, estimates and decisions.
 * Returns a draft only; POST /api/brain/retro/save stores what the user keeps.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  const ctx = await requireWorkspaceRole(user, body.taskId ? await workspaceOfTask(body.taskId) : await workspaceOfProject(body.projectId!), "viewer");
  assertAi(user.id);
  let data: string;
  let label: string;
  if (body.taskId) {
    const t = await prisma.task.findUniqueOrThrow({ where: { id: body.taskId }, select: { title: true, status: { select: { category: true } } } });
    if (t.status.category !== "done") throw badRequest("The task isn't finished yet");
    data = await taskRetroContext(body.taskId);
    label = t.title;
  } else {
    data = await projectRetroContext(body.projectId!);
    label = (await prisma.project.findUniqueOrThrow({ where: { id: body.projectId! }, select: { name: true } })).name;
  }
  const system = brainSystem({
    task: `Write a retrospective for the finished ${body.taskId ? "task" : "project"} "${label}". Base every point on the DATA (history of status/date changes, comments, files, estimate vs actual, recorded decisions). Include: a short retrospective (what happened, what went well, what didn't), lessons learned, key decisions that were made (with reason and alternatives if the data shows them), a reusable step-by-step process others can follow next time, and a concise knowledge note worth keeping.`,
    schema: '{"title":"...","retrospective":"...","lessons":["..."],"decisions":[{"title":"...","reason":"...","alternatives":["..."]}],"process":["step 1","step 2"],"knowledgeNote":"..."}',
    locale: user.locale ?? "vi",
    data,
    responseName: "retro",
  });
  const r = await generateJson<Record<string, unknown>>(system);
  const draft: RetroDraft = {
    title: str(r.title, 200) || `Retrospective: ${label}`,
    retrospective: str(r.retrospective, 6000),
    lessons: strList(r.lessons, 12),
    decisions: (Array.isArray(r.decisions) ? r.decisions : [])
      .map((d) => d as Record<string, unknown>)
      .map((d) => ({ title: str(d.title, 400), reason: str(d.reason, 2000), alternatives: strList(d.alternatives, 6, 300) }))
      .filter((d) => d.title)
      .slice(0, 10),
    process: strList(r.process, 20),
    knowledgeNote: str(r.knowledgeNote, 4000),
  };
  return NextResponse.json({ draft, source: body.taskId ? `task:${body.taskId}` : `project:${body.projectId}`, label, workspaceId: ctx.workspaceId });
});
