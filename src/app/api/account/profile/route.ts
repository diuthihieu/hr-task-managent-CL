import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, route, readJson } from "@/lib/authz";
import { nameSchema } from "@/lib/validation";

const SELECT = { id: true, name: true, email: true, jobTitle: true, avatarColor: true, avatarUpdatedAt: true, aiAbout: true, aiInstructions: true, aiTone: true, aiLength: true, googleSub: true, passwordHash: true } as const;

const schema = z.object({
  name: nameSchema.optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  aiAbout: z.string().trim().max(3000).nullable().optional(),
  aiInstructions: z.string().trim().max(3000).nullable().optional(),
  aiTone: z.enum(["professional", "friendly", "concise", "coach", "formal"]).optional(),
  aiLength: z.enum(["short", "balanced", "detailed"]).optional(),
});

function serialize(u: { id: string; avatarUpdatedAt: Date | null; googleSub: string | null; passwordHash: string | null } & Record<string, unknown>) {
  const { passwordHash, googleSub, avatarUpdatedAt, ...rest } = u;
  return {
    ...rest,
    avatarUrl: `/api/users/${u.id}/avatar?v=${avatarUpdatedAt?.getTime() ?? 0}`,
    hasUploadedAvatar: !!avatarUpdatedAt,
    googleLinked: !!googleSub,
    hasPassword: !!passwordHash,
  };
}

/** The caller's personal profile + AI personalization (custom instructions, tone, length). */
export const GET = route(async () => {
  const user = await requireUser();
  return NextResponse.json(serialize(await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: SELECT })));
});

export const PATCH = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  const data = { ...body, ...(body.aiAbout === "" ? { aiAbout: null } : {}), ...(body.aiInstructions === "" ? { aiInstructions: null } : {}), ...(body.jobTitle === "" ? { jobTitle: null } : {}) };
  const u = await prisma.user.update({ where: { id: user.id }, data: { ...data, updatedById: user.id }, select: SELECT });
  return NextResponse.json(serialize(u));
});
