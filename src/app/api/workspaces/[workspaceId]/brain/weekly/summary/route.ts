import { NextResponse } from "next/server";
import { z } from "zod";
import { route, readJson } from "@/lib/authz";
import { makeT } from "@/lib/i18n/core";
import { brainContext } from "@/lib/brain/route-helpers";
import { weeklyReview, weekStartOf } from "@/lib/brain/resurface";
import { assertAi, brainSystem, generateJson, str, strList } from "@/lib/brain/ai";

type P = { workspaceId: string };

export const maxDuration = 120;

/** AI write-up of the Weekly Brain Review (returned, not stored - the user can save it to a wiki page). */
export const POST = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user, access, base } = await brainContext(workspaceId);
  await assertAi(user.id);
  const { week } = z.object({ week: z.string().nullable().optional() }).parse(await readJson(req));
  const w = await weeklyReview(access, base, weekStartOf(week ?? null));
  const list = (t: string, xs: { title: string }[]) => `${t} (${xs.length}):\n${xs.map((x) => `- ${x.title}`).join("\n") || "(none)"}`;
  const data = [
    `Week starting ${w.weekStart}`,
    list("MY COMPLETED TASKS", w.completed),
    list("DECISIONS", w.decisions),
    list("NEW KNOWLEDGE", w.newKnowledge),
    list("UPDATED KNOWLEDGE", w.updatedKnowledge),
    list("MEETINGS", w.meetings),
    list("OPEN LOOPS (unfinished, overdue or due soon; proposed decisions; drafts)", w.openLoops),
    `REPEATED MANUAL TASKS (last 30 days): ${w.automation.map((a) => `${a.title} x${a.n}`).join("; ") || "(none)"}`,
    `PAGES DUE FOR REVIEW: ${w.reviewsDue}`,
    `JOURNAL SUMMARIES:\n${w.journalDays.map((j) => `${j.date}: ${j.aiSummary ?? "(no summary)"}`).join("\n") || "(none)"}`,
  ].join("\n\n");
  const system = brainSystem({
    task: "Write the user's weekly reflection from the DATA. wins: 2-5 concrete achievements; knowledge: 2-5 things learned or documented (cite page / decision titles in quotes); openLoops: what still needs closing and the next step; automation: work that could be automated or made a template / recurring task, and how; nextWeek: 3-5 focused priorities. Short, specific sentences; only from the DATA.",
    schema: '{"headline":"...","wins":["..."],"knowledge":["..."],"openLoops":["..."],"automation":["..."],"nextWeek":["..."]}',
    locale: user.locale ?? "vi",
    data,
    responseName: "weekly",
  });
  const r = await generateJson<Record<string, unknown>>(workspaceId, system);
  const reflection = { headline: str(r.headline, 300), wins: strList(r.wins, 6), knowledge: strList(r.knowledge, 6), openLoops: strList(r.openLoops, 8), automation: strList(r.automation, 6), nextWeek: strList(r.nextWeek, 6) };
  const t = makeT(user.locale === "en" ? "en" : "vi");
  const sec = (k: "wins" | "knowledge" | "openLoops" | "automation" | "nextWeek") => `## ${t(`brain.weekly.sec.${k}`)}\n${reflection[k].map((x) => `- ${x}`).join("\n") || "-"}`;
  const markdown = [reflection.headline && `**${reflection.headline}**`, sec("wins"), `## ${t("brain.weekly.sec.completed")}\n${w.completed.map((x) => `- ${x.title}`).join("\n") || "-"}`, `## ${t("brain.weekly.sec.decisions")}\n${w.decisions.map((x) => `- ${x.title}`).join("\n") || "-"}`, sec("knowledge"), sec("openLoops"), sec("automation"), sec("nextWeek")].filter(Boolean).join("\n\n");
  return NextResponse.json({ reflection, markdown, weekStart: w.weekStart });
});
