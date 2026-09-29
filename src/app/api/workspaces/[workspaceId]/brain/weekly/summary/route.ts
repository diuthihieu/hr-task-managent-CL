import { NextResponse } from "next/server";
import { z } from "zod";
import { route, readJson } from "@/lib/authz";
import { generate } from "@/lib/ai/gemini";
import { actionSystemPrompt } from "@/lib/ai/actions";
import { personalPromptBlock } from "@/lib/ai/personal";
import { brainContext } from "@/lib/brain/route-helpers";
import { weeklyReview, weekStartOf } from "@/lib/brain/resurface";
import { assertAi } from "@/lib/brain/ai";

type P = { workspaceId: string };

export const maxDuration = 120;

/** AI write-up of the Weekly Brain Review (returned, not stored - the user can save it to a wiki page). */
export const POST = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user, access, base, workspaceName } = await brainContext(workspaceId);
  assertAi(user.id);
  const { week } = z.object({ week: z.string().nullable().optional() }).parse(await readJson(req));
  const w = await weeklyReview(access, base, weekStartOf(week ?? null));
  const list = (t: string, xs: { title: string }[]) => `${t} (${xs.length}):\n${xs.map((x) => `- ${x.title}`).join("\n") || "(none)"}`;
  const data = [
    `Week starting ${w.weekStart}`,
    list("NEW KNOWLEDGE", w.newKnowledge),
    list("UPDATED KNOWLEDGE", w.updatedKnowledge),
    list("MEETINGS", w.meetings),
    list("DECISIONS", w.decisions),
    list("MY COMPLETED TASKS", w.completed),
    `PAGES DUE FOR REVIEW: ${w.reviewsDue}`,
    `JOURNAL SUMMARIES:\n${w.journalDays.map((j) => `${j.date}: ${j.aiSummary ?? "(no summary)"}`).join("\n") || "(none)"}`,
  ].join("\n\n");
  const system = actionSystemPrompt({
    area: "Weekly Brain Review",
    workspace: workspaceName,
    user: user.name,
    locale: user.locale ?? "vi",
    instructions: "Write the user's Weekly Brain Review: 'Highlights', 'What we learned', 'Decisions to remember', 'Knowledge to update or review', 'Focus for next week'. Only from the DATA; cite page / decision titles in quotes.",
    data,
    personal: await personalPromptBlock(user.id),
  });
  const r = await generate({ system, contents: [{ role: "user", parts: [{ text: "Write my weekly review." }] }], temperature: 0.3 });
  return NextResponse.json({ markdown: r.text, weekStart: w.weekStart });
});
