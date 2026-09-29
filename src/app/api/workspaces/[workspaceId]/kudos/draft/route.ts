import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, badRequest } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";
import { assertAi, brainSystem, generateJson, str, strList } from "@/lib/brain/ai";
import { kudosContext } from "@/lib/recognition/kudos-context";
import { KUDOS_STYLES, nfc } from "@/lib/recognition/core";
import { uuid } from "@/lib/validation";

type P = { workspaceId: string };

export const maxDuration = 60;

/** AI helps write a sincere thank-you letter from the sender's own words. Returns a draft to edit. */
export const POST = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user } = await recoContext(workspaceId, { sync: false });
  assertAi(user.id, "kudos");
  const body = z.object({ toId: uuid, reason: z.string().trim().max(1500).default(""), style: z.enum(KUDOS_STYLES).default("gratitude") }).parse(await readJson(req));
  const to = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: body.toId } }, select: { user: { select: { name: true } } } });
  if (!to) throw badRequest("Unknown receiver");
  const ctx = await kudosContext(user, workspaceId, body.toId);
  const system = brainSystem({
    task: `Help ${user.name} thank ${to.user.name}. Using WHAT THEY DID (the sender's words, if any) and OUR WORK TOGETHER (real history: tasks, comments, speed, on-time delivery, reporting, approvals): (1) suggest 3 short, specific reasons to thank them (each max 18 words, grounded in the history); (2) write the letter BODY only - no greeting line and no closing/signature, those are added separately - in a warm "${body.style.replace("_", " ")}" tone, 60-120 words, concrete about what they did and its impact, no clichés or invented facts; (3) a short title (max 8 words).`,
    schema: '{"reasons":["..."],"title":"...","message":"..."}',
    locale: user.locale ?? "vi",
    data: `WHAT THEY DID (sender's words): ${body.reason || "(not given - use the history)"}\n\nOUR WORK TOGETHER (last 90 days):\n${ctx.text}`,
    responseName: "kudos",
  });
  const r = await generateJson<{ title?: unknown; message?: unknown; reasons?: unknown }>(system);
  return NextResponse.json({ title: nfc(str(r.title, 200)), message: nfc(str(r.message, 4000)), reasons: strList(r.reasons, 3, 200).map(nfc), facts: ctx.facts });
});
