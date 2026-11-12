import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { aiConfigured, generate, parseJsonAnswer } from "@/lib/ai/gemini";
import { badRequest, requireUser, requireWorkspaceRole, readJson, route } from "@/lib/authz";
import { accessibleAgentSkillWhere } from "@/lib/agent-work/access";
import { assertAgentAiQuota } from "@/lib/agent-work/engine";
import { WORKFLOW_FREQUENCIES, workflowSchedule } from "@/lib/agent-work/schedule";

type P = { workspaceId: string };

const draft = z.object({
  skillId: z.string().uuid().nullable().catch(null),
  name: z.string().trim().min(2).max(160).catch("Workflow"),
  args: z.record(z.string(), z.unknown()).catch({}),
  note: z.string().trim().max(2000).nullable().catch(null),
  schedule: workflowSchedule.catch({ freq: "weekly", minute: 0, hour: 8, weekdays: [0], monthDay: 1 }),
  missingSkill: z.string().trim().max(500).nullable().catch(null),
});

/**
 * "Every Monday at 8am send me last week's report for the Recruitment project as Word": AI picks one of
 * my Skills, its arguments and the schedule. Nothing is saved; the person reviews the draft first.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  if (!aiConfigured()) throw badRequest("AI must be configured to draft a workflow");
  const { description } = z.object({ description: z.string().trim().min(10).max(2000) }).parse(await readJson(req));
  await assertAgentAiQuota(user.id);
  const [skills, projects] = await Promise.all([
    prisma.agentSkill.findMany({ where: { workspaceId, ...accessibleAgentSkillWhere(user.id) }, select: { id: true, name: true, description: true, command: true, parameters: true, outputDefinitions: true }, take: 60 }),
    prisma.project.findMany({ where: { workspaceId, deletedAt: null, hiddenMembers: { none: { userId: user.id } } }, select: { id: true, name: true }, take: 200 }),
  ]);
  const response = await generate({
    workspaceId,
    json: true,
    temperature: 0.1,
    maxOutputTokens: 1500,
    system: `You set up a scheduled workflow in Woli. Pick the ONE Skill (by id, from SKILLS) that produces what the person asks for; fill its parameters (args keyed by parameter key: date_range = one of the presets or {from,to}; projects = ids from PROJECTS; people = "me" or nothing; text = a string); put any extra wish into note. Times are Vietnam time. The schedule runs at most once an hour. Return JSON only: {"skillId": string|null, "name": short name in the person's language, "args": {}, "note": string|null, "schedule": {"freq": one of ${WORKFLOW_FREQUENCIES.join("|")}, "minute": 0-59, "hour": 0-23, "weekdays": [0=Mon..6=Sun], "monthDay": 1-31 (31 = last day)}, "missingSkill": null, or when no Skill fits, one sentence describing the Skill to create}.`,
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ request: description, SKILLS: skills, PROJECTS: projects }) }] }],
  });
  const parsed = draft.parse(parseJsonAnswer<unknown>(response.text) ?? {});
  // Never trust ids the model invents.
  if (parsed.skillId && !skills.some((s) => s.id === parsed.skillId)) parsed.skillId = null;
  return NextResponse.json({ ...parsed, description });
});
