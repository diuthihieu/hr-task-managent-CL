import Link from "next/link";
import { redirect } from "next/navigation";
import { LayoutGrid, Monitor, Download, UserPlus, Building2, Users, FolderKanban, BarChart3, Database, Target, FileText, PieChart, ShieldCheck, Palette, Check } from "lucide-react";
import { getSessionUser } from "@/lib/authz";
import { getServerT } from "@/lib/prefs";
import { getLatestRelease, DEFAULT_PLATFORM } from "@/lib/desktop-releases";
import { AuthCard } from "@/components/landing/auth-card";
import { LocaleSwitch } from "@/components/landing/locale-switch";

export const dynamic = "force-dynamic";

// Public home page: sign in / sign up on top, then the how-to guide, the
// benefits and the Windows download. Signed-in users go to their workspaces.
export default async function HomePage({ searchParams }: { searchParams: Promise<{ auth?: string; callbackUrl?: string }> }) {
  const [{ auth, callbackUrl }, user] = await Promise.all([searchParams, getSessionUser()]);
  if (user) redirect("/workspaces");
  const { t, locale } = await getServerT();
  const latest = await getLatestRelease(DEFAULT_PLATFORM, "stable").catch(() => null);
  const date = (d: Date) => d.toLocaleDateString(locale === "vi" ? "vi-VN" : "en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

  const steps = [
    { icon: UserPlus, t: t("landing.guide.s1.t"), d: t("landing.guide.s1.d") },
    { icon: Building2, t: t("landing.guide.s2.t"), d: t("landing.guide.s2.d") },
    { icon: Users, t: t("landing.guide.s3.t"), d: t("landing.guide.s3.d") },
    { icon: FolderKanban, t: t("landing.guide.s4.t"), d: t("landing.guide.s4.d") },
    { icon: BarChart3, t: t("landing.guide.s5.t"), d: t("landing.guide.s5.d") },
  ];
  const benefits = [
    { icon: Database, t: t("landing.benefits.b1.t"), d: t("landing.benefits.b1.d") },
    { icon: Target, t: t("landing.benefits.b2.t"), d: t("landing.benefits.b2.d") },
    { icon: FileText, t: t("landing.benefits.b3.t"), d: t("landing.benefits.b3.d") },
    { icon: PieChart, t: t("landing.benefits.b4.t"), d: t("landing.benefits.b4.d") },
    { icon: ShieldCheck, t: t("landing.benefits.b5.t"), d: t("landing.benefits.b5.d") },
    { icon: Palette, t: t("landing.benefits.b6.t"), d: t("landing.benefits.b6.d") },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <header className="sticky top-0 z-30 border-b border-neutral-200/70 dark:border-neutral-800/70 bg-white/80 dark:bg-neutral-950/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
              <LayoutGrid size={17} />
            </span>
            Basework
          </Link>
          <nav className="hidden md:flex items-center gap-5 text-sm text-neutral-600 dark:text-neutral-400 ml-4">
            <a href="#guide" className="hover:text-neutral-900 dark:hover:text-white">{t("landing.nav.guide")}</a>
            <a href="#benefits" className="hover:text-neutral-900 dark:hover:text-white">{t("landing.nav.benefits")}</a>
            <a href="#desktop" className="hover:text-neutral-900 dark:hover:text-white">{t("landing.nav.desktop")}</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LocaleSwitch />
            <a href="#auth" className="hidden sm:inline-flex text-sm font-medium rounded-md px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-500">
              {t("auth.signIn")} / {t("auth.signUp")}
            </a>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-indigo-50 via-white to-white dark:from-indigo-950/40 dark:via-neutral-950 dark:to-neutral-950" />
        <div className="max-w-6xl mx-auto px-4 py-12 md:py-20 grid md:grid-cols-[1fr_auto] gap-10 items-center">
          <div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight leading-tight">{t("landing.hero.title")}</h1>
            <p className="mt-5 text-base md:text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl">{t("landing.hero.subtitle")}</p>
            <ul className="mt-6 space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
              {[t("landing.hero.point1"), t("landing.hero.point2"), t("landing.hero.point3")].map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <Check size={16} className="text-indigo-600" /> {p}
                </li>
              ))}
            </ul>
          </div>
          <AuthCard initialMode={auth === "register" ? "register" : "login"} callbackUrl={callbackUrl} />
        </div>
      </section>

      <section id="guide" className="scroll-mt-16 border-t border-neutral-100 dark:border-neutral-900 py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold">{t("landing.guide.title")}</h2>
          <p className="mt-2 text-neutral-600 dark:text-neutral-400">{t("landing.guide.subtitle")}</p>
          <ol className="mt-8 grid gap-4 md:grid-cols-5">
            {steps.map((s, i) => (
              <li key={s.t} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-5 bg-white dark:bg-neutral-900">
                <div className="flex items-center gap-2 mb-3">
                  <span className="h-7 w-7 rounded-full bg-indigo-600 text-white text-sm font-semibold flex items-center justify-center">{i + 1}</span>
                  <s.icon size={18} className="text-indigo-600" />
                </div>
                <h3 className="font-semibold">{s.t}</h3>
                <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="benefits" className="scroll-mt-16 bg-neutral-50 dark:bg-neutral-900/40 py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold">{t("landing.benefits.title")}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {benefits.map((b) => (
              <div key={b.t} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-5 bg-white dark:bg-neutral-900">
                <span className="h-10 w-10 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 flex items-center justify-center mb-3">
                  <b.icon size={20} />
                </span>
                <h3 className="font-semibold">{b.t}</h3>
                <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">{b.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="desktop" className="scroll-mt-16 py-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-8">
            <div className="h-16 w-16 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              <Monitor size={32} />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold">{t("landing.desktop.title")}</h2>
              <p className="mt-1 text-indigo-100">{t("landing.desktop.subtitle")}</p>
              {latest ? (
                <p className="mt-3 text-sm text-indigo-100" data-testid="landing-desktop-meta">
                  {t("landing.desktop.version", { version: latest.version })} · {t("landing.desktop.released", { date: date(latest.publishedAt) })} · {t("landing.desktop.os", { os: latest.minOsVersion })}
                </p>
              ) : (
                <p className="mt-3 text-sm text-indigo-100">{t("landing.desktop.none")}</p>
              )}
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              {latest && (
                <a href="/api/desktop/download/latest" className="inline-flex items-center justify-center gap-2 rounded-lg bg-white text-indigo-700 font-semibold px-5 py-3 hover:bg-indigo-50" data-testid="landing-desktop-download">
                  <Download size={18} /> {t("landing.desktop.button")}
                </a>
              )}
              <Link href="/download" className="text-center text-sm text-indigo-100 hover:text-white underline-offset-2 hover:underline">
                {t("landing.desktop.details")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-neutral-100 dark:border-neutral-900 py-8 text-center text-sm text-neutral-500">{t("landing.footer", { year: new Date().getFullYear() })}</footer>
    </div>
  );
}
