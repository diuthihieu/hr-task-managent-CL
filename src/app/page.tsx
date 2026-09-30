import { googleEnabled } from "@/lib/auth";
import { HeroBackground, ScreenshotMarquee } from "@/components/landing/hero-visuals";
import { HeroMascot, TaskMascot, KnowledgeMascot } from "@/components/landing/mascots";
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { workspaceLogoUrl } from "@/lib/workspace-logo";
import { redirect } from "next/navigation";
import { Monitor, Download, Target, PieChart, Check, ArrowRight, PlayCircle, ClipboardList, BookOpen, Sparkles } from "lucide-react";
import { AiSection, GetStarted, WhyWoli } from "@/components/landing/sections";
import { Brand } from "@/components/brand/brand";
import { WorkspaceAvatar } from "@/components/workspaces/workspace-avatar";
import type { MessageKey } from "@/lib/i18n/core";
import { getSessionUser } from "@/lib/authz";
import { getServerT } from "@/lib/prefs";
import { getLatestRelease, DEFAULT_PLATFORM } from "@/lib/desktop-releases";
import { AuthCard } from "@/components/landing/auth-card";
import { LocaleSwitch } from "@/components/landing/locale-switch";

export const dynamic = "force-dynamic";

/** A shared workspace link (?ws=slug) previews that workspace's name and logo. */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ ws?: string }> }): Promise<Metadata> {
  const { ws } = await searchParams;
  if (!ws) return {};
  const w = await prisma.workspace.findFirst({ where: { slug: ws, deletedAt: null }, select: { name: true, slug: true, logoUpdatedAt: true } });
  if (!w) return {};
  const logo = workspaceLogoUrl(w);
  const title = `${w.name} · woli`;
  return {
    title,
    description: `Sign in to open the ${w.name} workspace on woli`,
    ...(logo ? { icons: { icon: logo, apple: logo } } : {}),
    // With a workspace logo the preview shows it; otherwise the standard woli card.
    openGraph: { title, siteName: "woli", type: "website", images: logo ? [{ url: logo, width: 256, height: 256 }] : [{ url: "/og/woli-og.png?v=1", width: 1200, height: 630 }] },
    twitter: logo ? { card: "summary", title, images: [logo] } : { card: "summary_large_image", title, images: ["/og/woli-og.png?v=1"] },
  };
}

// Public home page: sign in / sign up on top, then the how-to guide, the
// benefits and the Windows download. Signed-in users go to their workspaces.
export default async function HomePage({ searchParams }: { searchParams: Promise<{ auth?: string; callbackUrl?: string; ws?: string; error?: string }> }) {
  const [{ auth, callbackUrl, ws, error }, user] = await Promise.all([searchParams, getSessionUser()]);
  if (user) redirect(callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/workspaces");
  const { t, locale } = await getServerT();
  const [latest, invited] = await Promise.all([
    getLatestRelease(DEFAULT_PLATFORM, "stable").catch(() => null),
    ws ? prisma.workspace.findFirst({ where: { slug: ws, deletedAt: null }, select: { name: true, slug: true, logoUpdatedAt: true } }) : null,
  ]);
  // The waving mascot greets visitors; once they ask to sign in / sign up (or
  // arrive from a workspace link) the form takes its place.
  const showAuth = Boolean(auth || ws || error || callbackUrl);
  const date = (d: Date) => d.toLocaleDateString(locale === "vi" ? "vi-VN" : "en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

  const features = [
    { icon: ClipboardList, t: t("landing.f.tasks.t"), d: t("landing.f.tasks.d") },
    { icon: Target, t: t("landing.f.okr.t"), d: t("landing.f.okr.d") },
    { icon: BookOpen, t: t("landing.f.wiki.t"), d: t("landing.f.wiki.d") },
    { icon: Sparkles, t: t("landing.f.ai.t"), d: t("landing.f.ai.d") },
    { icon: PieChart, t: t("landing.f.reports.t"), d: t("landing.f.reports.d") },
  ];

  return (
    <div className="min-h-screen overflow-x-clip bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <header className="sticky top-0 z-30 bg-white/85 dark:bg-neutral-950/85 backdrop-blur border-b border-neutral-100 dark:border-neutral-900">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-4">
          <Link href="/" aria-label="woli">
            <Brand size={32} textClassName="text-xl" />
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-neutral-600 dark:text-neutral-400 ml-6">
            <a href="#features" className="hover:text-neutral-900 dark:hover:text-white">{t("landing.nav.features")}</a>
            <a href="#guide" className="hover:text-neutral-900 dark:hover:text-white">{t("landing.nav.guide")}</a>
            <a href="#ai" className="hover:text-neutral-900 dark:hover:text-white">{t("landing.nav.ai")}</a>
            <a href="#benefits" className="hover:text-neutral-900 dark:hover:text-white">{t("landing.nav.benefits")}</a>
            <a href="#desktop" className="hover:text-neutral-900 dark:hover:text-white">{t("landing.nav.desktop")}</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LocaleSwitch />
            <a href="?auth=login#auth" className="hidden sm:inline-flex text-sm font-medium rounded-lg px-3.5 py-2 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900">
              {t("auth.signIn")}
            </a>
            <a href="?auth=register#auth" className="inline-flex text-sm font-semibold rounded-lg px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm shadow-indigo-600/20">
              {t("landing.signUpFree")}
            </a>
          </div>
        </div>
      </header>

      <section className="relative isolate overflow-hidden">
        <HeroBackground />
        <div className={`max-w-6xl mx-auto px-4 pt-12 pb-10 md:pt-20 md:pb-14 grid gap-10 lg:gap-12 items-center ${showAuth ? "lg:grid-cols-[1fr_400px]" : "lg:grid-cols-[1fr_minmax(0,460px)]"}`}>
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200/70 dark:border-indigo-900 bg-white/70 dark:bg-neutral-900/70 px-3 py-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" /> {t("landing.hero.badge")}
            </span>
            <h1 className="mt-5 text-4xl md:text-[3.5rem] font-bold tracking-[-0.03em] leading-[1.06] text-neutral-900 dark:text-white">
              {t("landing.hero.title1")} <span className="text-indigo-600">{t("landing.hero.title2")}</span>
            </h1>
            <p className="mt-5 text-base md:text-lg text-neutral-600 dark:text-neutral-400 max-w-xl leading-relaxed">{t("landing.hero.subtitle")}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="?auth=register#auth" className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white font-semibold px-5 py-3 hover:bg-indigo-500 shadow-sm shadow-indigo-600/20 transition-colors">
                {t("landing.hero.cta")} <ArrowRight size={17} />
              </a>
              <a href="#guide" className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 font-semibold px-5 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                <PlayCircle size={17} className="text-indigo-600" /> {t("landing.hero.cta2")}
              </a>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
              {[t("landing.hero.point1"), t("landing.hero.point2"), t("landing.hero.point3")].map((p) => (
                <li key={p} className="flex items-center gap-1.5">
                  <Check size={15} className="text-indigo-600" /> {p}
                </li>
              ))}
            </ul>
          </div>
          {showAuth ? (
          <div className="w-full flex flex-col items-center gap-3">
            {invited && (
              <div className="w-full max-w-sm flex items-center gap-3 rounded-2xl border border-indigo-200 dark:border-indigo-900 bg-white dark:bg-neutral-900 px-4 py-3" data-testid="invited-workspace">
                <WorkspaceAvatar name={invited.name} logoUrl={workspaceLogoUrl(invited)} size={36} />
                <div className="min-w-0 text-sm">
                  <div className="text-xs text-neutral-500">{t("landing.openWorkspace")}</div>
                  <div className="font-semibold truncate">{invited.name}</div>
                </div>
              </div>
            )}
            <AuthCard initialMode={auth === "register" ? "register" : "login"} callbackUrl={callbackUrl} googleEnabled={googleEnabled} error={error} />
          </div>
          ) : (
            <HeroMascot alt={t("landing.mascot.hero")} />
          )}
        </div>
        <div className="pb-14 md:pb-20">
          <p className="text-center text-xs font-medium uppercase tracking-[0.14em] text-neutral-400 mb-5">{t("landing.shots.caption")}</p>
          <ScreenshotMarquee
            label={t("landing.shots.caption")}
            shots={[
              { src: "/landing/home.webp", label: t("landing.shots.home") },
              { src: "/landing/kanban.webp", label: t("landing.shots.kanban") },
              { src: "/landing/okr.webp", label: t("landing.shots.okr") },
              { src: "/landing/report.webp", label: t("landing.shots.report") },
              { src: "/landing/wiki.webp", label: t("landing.shots.wiki") },
              { src: "/landing/grid.webp", label: t("landing.shots.grid") },
              { src: "/landing/task.webp", label: t("landing.shots.task") },
              { src: "/landing/gallery.webp", label: t("landing.shots.gallery") },
            ]}
          />
        </div>
      </section>

      <section id="features" className="scroll-mt-16 pb-16">
        <div className="max-w-6xl mx-auto px-4 grid gap-8 lg:grid-cols-[1.35fr_1fr] items-center">
          <div className="mascot-host relative min-w-0 lg:pl-36">
            <ProductPreview t={t} />
            {/* Beside the card (just touching its edge on desktop), never over its text. */}
            <TaskMascot alt={t("landing.mascot.task")} className="relative z-10 mx-auto mt-6 w-[140px] sm:w-[160px] lg:absolute lg:mx-0 lg:mt-0 lg:-left-6 lg:-bottom-8 lg:w-[180px]" />
          </div>
          <ul className="space-y-5">
            {features.map((f) => (
              <li key={f.t} className="flex gap-4">
                <span className="h-12 w-12 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm text-indigo-600 flex items-center justify-center shrink-0">
                  <f.icon size={22} />
                </span>
                <div>
                  <h3 className="font-bold">{f.t}</h3>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-0.5">{f.d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="knowledge" className="scroll-mt-16 py-16 md:py-20">
        <div className="mascot-host max-w-6xl mx-auto px-4 grid gap-10 lg:grid-cols-[1fr_minmax(0,460px)] items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
              <BookOpen size={13} /> {t("landing.kb.badge")}
            </span>
            <h2 className="mt-4 text-2xl md:text-4xl font-bold tracking-tight">{t("landing.kb.title")}</h2>
            <p className="mt-3 text-neutral-600 dark:text-neutral-400 max-w-xl leading-relaxed">{t("landing.kb.subtitle")}</p>
            <ul className="mt-6 space-y-3">
              {[t("landing.kb.p1"), t("landing.kb.p2"), t("landing.kb.p3"), t("landing.kb.p4")].map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-neutral-700 dark:text-neutral-300">
                  <span className="mt-0.5 h-5 w-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                    <Check size={12} />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <KnowledgeMascot alt={t("landing.mascot.knowledge")} className="mx-auto w-full max-w-[300px] sm:max-w-[380px] lg:max-w-[460px]" />
        </div>
      </section>

      <WhyWoli t={t} />
      <AiSection t={t} />
      <GetStarted t={t} />

      <section id="desktop" className="scroll-mt-16 pb-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="rounded-3xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-8 shadow-xl shadow-indigo-600/20">
            <div className="h-16 w-16 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
              <Monitor size={32} />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold">{t("landing.desktop.title")}</h2>
              <p className="mt-1 text-white/85">{t("landing.desktop.subtitle")}</p>
              {latest ? (
                <p className="mt-3 text-sm text-white/85" data-testid="landing-desktop-meta">
                  <span className="inline-flex flex-wrap gap-x-4 gap-y-1"><span>{t("landing.desktop.version", { version: latest.version })}</span><span>{t("landing.desktop.released", { date: date(latest.publishedAt) })}</span><span>{t("landing.desktop.os", { os: latest.minOsVersion })}</span></span>
                </p>
              ) : (
                <p className="mt-3 text-sm text-white/85">{t("landing.desktop.none")}</p>
              )}
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              {latest && (
                <a href="/api/desktop/download/latest" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white text-indigo-700 font-semibold px-5 py-3 hover:bg-indigo-50" data-testid="landing-desktop-download">
                  <Download size={18} /> {t("landing.desktop.button")}
                </a>
              )}
              <Link href="/download" className="text-center text-sm text-white/85 hover:text-white underline-offset-2 hover:underline">
                {t("landing.desktop.details")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-neutral-100 dark:border-neutral-900 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center gap-3 justify-between text-sm text-neutral-500">
          <Brand size={24} textClassName="text-base" />
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-neutral-900 dark:hover:text-white">{t("landing.privacy")}</Link>
            <Link href="/terms" className="hover:text-neutral-900 dark:hover:text-white">{t("landing.terms")}</Link>
            <span>{t("landing.footer", { year: new Date().getFullYear() })}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Illustration of the app (static sample content) next to the feature list. */
function ProductPreview({ t }: { t: (k: MessageKey, v?: Record<string, string | number>) => string }) {
  const rows = [
    { title: t("landing.pv.r1"), tag: t("landing.pv.tag1"), done: true, due: "12/10" },
    { title: t("landing.pv.r2"), tag: t("landing.pv.tag2"), done: false, due: "15/10" },
    { title: t("landing.pv.r3"), tag: t("landing.pv.tag3"), done: false, due: "18/10" },
    { title: t("landing.pv.r4"), tag: t("landing.pv.tag4"), done: false, due: "22/10" },
  ];
  return (
    <div className="relative" aria-hidden="true">
      <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-indigo-100/80 to-transparent dark:from-indigo-950/40 blur-2xl" />
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-2xl shadow-neutral-900/10 overflow-hidden">
        <div className="flex items-center gap-1.5 px-4 h-9 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
          <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              [t("home.kpi.open"), "12", "bg-sky-50 text-sky-600 dark:bg-sky-950"],
              [t("home.kpi.inProgress"), "8", "bg-indigo-50 text-indigo-600 dark:bg-indigo-950"],
              [t("home.kpi.overdue"), "2", "bg-red-50 text-red-600 dark:bg-red-950"],
            ].map(([l, v, c]) => (
              <div key={l} className="rounded-xl border border-neutral-100 dark:border-neutral-800 p-3">
                <div className="text-[11px] text-neutral-500 truncate">{l}</div>
                <div className={`mt-1 inline-flex rounded-lg px-2 text-xl font-bold ${c}`}>{v}</div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-neutral-100 dark:border-neutral-800">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-100 dark:border-neutral-800">
              <span className="text-sm font-semibold">{t("home.myTasks")}</span>
              <span className="flex gap-1 text-[11px]">
                <span className="rounded-md bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-2 py-0.5">List</span>
                <span className="rounded-md px-2 py-0.5 text-neutral-500">Kanban</span>
                <span className="rounded-md px-2 py-0.5 text-neutral-500">Gantt</span>
              </span>
            </div>
            {rows.map((r) => (
              <div key={r.title} className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 border-neutral-100 dark:border-neutral-800 text-sm">
                <span className={`h-4 w-4 rounded-full border-2 shrink-0 ${r.done ? "bg-emerald-500 border-emerald-500" : "border-neutral-300"}`} />
                <span className="flex-1 min-w-0 truncate">{r.title}</span>
                <span className="shrink-0 whitespace-nowrap rounded-md bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-[11px]">{r.tag}</span>
                <span className="text-xs text-neutral-400 w-10 text-right">{r.due}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-neutral-100 dark:border-neutral-800 p-4">
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>{t("landing.pv.okr")}</span>
              <span className="text-indigo-600">68%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
              <div className="h-full w-[68%] rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
