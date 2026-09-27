import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, route, readJson } from "@/lib/authz";
import { ACCENT_NAMES } from "@/lib/theme-colors";
import { nameSchema } from "@/lib/validation";

const schema = z.object({
  name: nameSchema.optional(),
  locale: z.enum(["vi", "en"]).optional(),
  accentColor: z.enum(ACCENT_NAMES as [string, ...string[]]).optional(),
});

/** The caller's own profile + UI preferences (language, accent color). */
export const GET = route(async () => {
  const user = await requireUser();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { name: true, email: true, locale: true, accentColor: true } });
  return NextResponse.json(u);
});

export const PATCH = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  const u = await prisma.user.update({
    where: { id: user.id },
    data: { ...body, updatedById: user.id },
    select: { name: true, email: true, locale: true, accentColor: true },
  });
  const res = NextResponse.json(u);
  // Mirrors for the signed-out pages (landing / login) - the DB stays the source of truth.
  const cookie = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };
  res.cookies.set("bw_locale", u.locale, cookie);
  res.cookies.set("bw_accent", u.accentColor, cookie);
  return res;
});
