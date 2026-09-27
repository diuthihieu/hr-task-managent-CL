import "server-only";
import { cookies } from "next/headers";
import { auth } from "./auth";
import { prisma } from "./prisma";
import { makeT, normalizeLocale, type Locale } from "./i18n/core";
import { normalizeAccent, type AccentName } from "./theme-colors";

/** Language + accent for this request: the signed-in user's saved preferences, else the cookies set on the landing page. */
export async function getRequestPrefs(): Promise<{ locale: Locale; accent: AccentName }> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (id) {
    const u = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { locale: true, accentColor: true } });
    if (u) return { locale: normalizeLocale(u.locale), accent: normalizeAccent(u.accentColor) };
  }
  const jar = await cookies();
  return { locale: normalizeLocale(jar.get("bw_locale")?.value), accent: normalizeAccent(jar.get("bw_accent")?.value) };
}

export async function getServerT() {
  const { locale } = await getRequestPrefs();
  return { locale, t: makeT(locale) };
}
