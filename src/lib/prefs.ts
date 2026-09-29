import "server-only";
import { cookies } from "next/headers";
import { auth } from "./auth";
import { prisma } from "./prisma";
import { makeT, normalizeLocale, type Locale } from "./i18n/core";
import { normalizeAccent, normalizeThemeMode, normalizeTone, normalizeFontSize, normalizeDisplaySize, type AccentName, type ThemeMode, type SurfaceTone, type FontSize, type DisplaySize } from "./theme-colors";

type Prefs = { locale: Locale; accent: AccentName; themeMode: ThemeMode; tone: SurfaceTone; fontSize: FontSize; displaySize: DisplaySize };

/** Language, accent, light/dark/system and surface tone for this request: the signed-in user's saved preferences, else the cookies set on the landing page. */
export async function getRequestPrefs(): Promise<Prefs> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (id) {
    const u = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { locale: true, accentColor: true, themeMode: true, surfaceTone: true, fontSize: true, displaySize: true } });
    if (u)
      return { locale: normalizeLocale(u.locale), accent: normalizeAccent(u.accentColor), themeMode: normalizeThemeMode(u.themeMode), tone: normalizeTone(u.surfaceTone), fontSize: normalizeFontSize(u.fontSize), displaySize: normalizeDisplaySize(u.displaySize) };
  }
  const jar = await cookies();
  return {
    locale: normalizeLocale(jar.get("bw_locale")?.value),
    accent: normalizeAccent(jar.get("bw_accent")?.value),
    themeMode: normalizeThemeMode(jar.get("bw_theme")?.value),
    tone: normalizeTone(jar.get("bw_tone")?.value),
    fontSize: normalizeFontSize(jar.get("bw_font")?.value),
    displaySize: normalizeDisplaySize(jar.get("bw_display")?.value),
  };
}

export async function getServerT() {
  const { locale } = await getRequestPrefs();
  return { locale, t: makeT(locale) };
}
