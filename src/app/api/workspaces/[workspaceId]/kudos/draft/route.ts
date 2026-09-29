import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, badRequest } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";
import { assertAi, brainSystem, generateJson, str } from "@/lib/brain/ai";
import { KUDOS_STYLES } from "@/lib/recognition/core";
import { uuid } from "@/lib/validation";

type P = { workspaceId: string };

export const maxDuration = 60;

/** AI helps write a sincere thank-you letter from the sender's own words. Returns a draft to edit. */
export const POST = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user } = await recoContext(workspaceId, { sync: false });
  assertAi(user.id, "kudos");
  const body = z.object({ toId: uuid, reason: z.string().trim().min(3).max(1500), style: z.enum(KUDOS_STYLES).default("gratitude") }).parse(await readJson(req));
  const to = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: body.toId } }, select: { user: { select: { name: true } } } });
  if (!to) throw badRequest("Unknown receiver");
  const system = brainSystem({
    task: `Write a short, sincere thank-you letter from ${user.name} to ${to.user.name}, in a warm "${body.style.replace("_", " ")}" tone. Mention concretely what they did (from WHAT THEY DID) and its impact; no clichés, no exaggeration, no invented facts. 80-140 words, greeting and closing included. Also suggest a short title (max 8 words).`,
    schema: '{"title":"...","message":"..."}',
    locale: user.locale ?? "vi",
    data: `WHAT THEY DID (in the sender's words): ${body.reason}`,
    responseName: "kudos",
  });
  const r = await generateJson<{ title?: unknown; message?: unknown }>(system);
  return NextResponse.json({ title: str(r.title, 200), message: str(r.message, 4000) });
});
