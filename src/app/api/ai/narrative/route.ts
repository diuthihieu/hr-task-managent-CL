import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfDashboard, workspaceOfProject, HttpError } from "@/lib/authz";
import { aiConfigured, generate } from "@/lib/ai/gemini";
import { actionSystemPrompt } from "@/lib/ai/actions";
import { personalPromptBlock } from "@/lib/ai/personal";
import { rateLimit } from "@/lib/rate-limit";
import { uuid } from "@/lib/validation";
import { NARRATIVE_PROMPT_MAX } from "@/lib/ai/report-limits";

export const maxDuration = 60;


const schema = z.object({
  targetKind: z.enum(["project", "dashboard"]),
  targetId: uuid,
  /** What the other widgets currently show (respecting filters). */
  data: z.string().min(1).max(40_000),
  /** Optional focus set on the widget ("overdue risks", "for the HR director"...). */
  instruction: z.string().trim().max(NARRATIVE_PROMPT_MAX).optional(),
});

/**
 * AI Narrative widget: a short, plain-language reading of what the dashboard
 * shows right now. The widget calls this again whenever the numbers change.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server (GEMINI_API_KEY missing)");
  if (!(await rateLimit(`ai-narrative:${user.id}`, 40, 10 * 60_000))) throw new HttpError(429, "The AI narrative refreshes too often - it will update again in a few minutes");
  let workspaceId: string;
  let source: string;
  if (body.targetKind === "project") {
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfProject(body.targetId), "viewer")).workspaceId;
    source = `Dashboard view of project: ${(await prisma.project.findUniqueOrThrow({ where: { id: body.targetId }, select: { name: true } })).name}`;
  } else {
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfDashboard(body.targetId), "viewer")).workspaceId;
    source = `Dashboard: ${(await prisma.dashboard.findUniqueOrThrow({ where: { id: body.targetId }, select: { name: true } })).name}`;
  }
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } });
  const system = actionSystemPrompt({
    area: "dashboard",
    workspace: ws.name,
    user: user.name,
    locale: user.locale ?? "vi",
    instructions: `Write the "AI narrative" card of this dashboard: a short reading of what the numbers show right now, for someone glancing at it.
- At most ~120 words: one headline sentence, then 2-4 bullets with the key facts (specific numbers), what stands out (risks, concentration, change) and one suggested next step.
- No title, no preamble, no repeating every number.${body.instruction ? `\n- Focus requested by the dashboard owner: ${body.instruction}` : ""}`,
    data: `${source}\n\n${body.data}`,
    personal: await personalPromptBlock(user.id),
  });
  const r = await generate({ workspaceId, system, contents: [{ role: "user", parts: [{ text: "Write the narrative for the current data." }] }], temperature: 0.3, maxOutputTokens: 1024 });
  const text = r.text.trim();
  if (!text) throw new HttpError(502, "The AI didn't return a narrative - it will try again when the data changes");
  return NextResponse.json({ text: text.slice(0, 4000), at: new Date().toISOString() });
});
