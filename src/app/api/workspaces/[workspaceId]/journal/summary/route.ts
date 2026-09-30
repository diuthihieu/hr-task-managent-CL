import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson } from "@/lib/authz";
import { generate } from "@/lib/ai/gemini";
import { htmlToText } from "@/lib/ai/extract";
import { brainAccess } from "@/lib/brain/access";
import { journalDay, journalText } from "@/lib/brain/journal";
import { assertAi } from "@/lib/brain/ai";
import { actionSystemPrompt } from "@/lib/ai/actions";
import { personalPromptBlock } from "@/lib/ai/personal";

type P = { workspaceId: string };

export const maxDuration = 120;

const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), tz: z.number().int().min(-840).max(840).default(0) });

/** AI summary of the day ("what I did, decided and learned"). Stored next to - never instead of - the notes. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  await assertAi(user.id);
  const body = schema.parse(await readJson(req));
  const access = await brainAccess(user, workspaceId, ctx.role);
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true, name: true } });
  const j = await journalDay(access, `/w/${ws.slug}`, body.date, body.tz);
  const system = actionSystemPrompt({
    area: "work journal",
    workspace: ws.name,
    user: user.name,
    locale: user.locale ?? "vi",
    instructions: "Write the user's end-of-day journal summary from the DATA: 'Done', 'Decided', 'Learned', 'Open loops / tomorrow'. Short bullets, first person, no invented items.",
    data: journalText(j, htmlToText(j.notes)),
    personal: await personalPromptBlock(user.id),
  });
  const r = await generate({ workspaceId, system, contents: [{ role: "user", parts: [{ text: "Summarize my day." }] }], temperature: 0.3 });
  const date = new Date(`${body.date}T00:00:00Z`);
  await prisma.journalEntry.upsert({
    where: { userId_workspaceId_date: { userId: user.id, workspaceId, date } },
    create: { userId: user.id, workspaceId, date, aiSummary: r.text },
    update: { aiSummary: r.text },
  });
  return NextResponse.json({ aiSummary: r.text });
});
