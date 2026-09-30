// Lower landing sections: "Why teams use woli" (feature cards with small
// product illustrations), "AI where the work happens" (an in-context AI demo)
// and "Get started in 5 steps". Static sample content, server-rendered.
import Image from "next/image";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  FileText,
  FolderClosed,
  Globe,
  Link2,
  ListChecks,
  Moon,
  MoreHorizontal,
  Plus,
  Repeat,
  Search,
  Send,
  Settings2,
  Share2,
  Sparkles,
  Sun,
  Target,
  UserPlus,
  Users,
  UserRound,
  Crown,
  PenLine,
  Eye,
  X,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n/core";

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200/80 dark:border-indigo-900 bg-indigo-50/80 dark:bg-indigo-950/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-indigo-700 dark:text-indigo-300">
    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> {children}
  </span>
);

const IconTile = ({ icon: Icon }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }) => (
  <span className="h-11 w-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0 ring-1 ring-indigo-100 dark:ring-indigo-900/60">
    <Icon size={20} strokeWidth={1.75} />
  </span>
);

const FACES = ["#f97316", "#0ea5e9", "#8b5cf6", "#10b981", "#ec4899"];
const Faces = ({ n = 3, more }: { n?: number; more?: string }) => (
  <span className="flex items-center">
    {FACES.slice(0, n).map((c, i) => (
      <span key={c} className="h-6 w-6 rounded-full ring-2 ring-white dark:ring-neutral-900 flex items-center justify-center text-[9px] font-semibold text-white -ml-1.5 first:ml-0" style={{ backgroundColor: c }}>
        {"AMLKT"[i]}
      </span>
    ))}
    {more && <span className="ml-1.5 text-[11px] text-neutral-500">{more}</span>}
  </span>
);

function Card({ icon, title, desc, children, testId }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; title: string; desc: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex flex-col gap-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_14px_34px_-18px_rgba(15,23,42,0.28)] transition-shadow" data-testid={testId}>
      <div className="flex gap-3">
        <IconTile icon={icon} />
        <div className="min-w-0">
          <h3 className="font-semibold text-[15px] leading-tight">{title}</h3>
          <p className="mt-1 text-[13px] leading-snug text-neutral-600 dark:text-neutral-400">{desc}</p>
        </div>
      </div>
      <div className="mt-auto rounded-xl border border-neutral-100 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/40 p-3 text-[11px]" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Why woli */

export function WhyWoli({ t }: { t: T }) {
  return (
    <section id="benefits" className="scroll-mt-16 py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-4 grid gap-10 lg:grid-cols-[minmax(0,20rem)_1fr] items-start">
        <div className="lg:sticky lg:top-24">
          <Badge>{t("landing.why.badge")}</Badge>
          <h2 className="mt-4 text-3xl md:text-[2.5rem] font-bold tracking-tight leading-[1.1]">{t("landing.why.title")}</h2>
          <p className="mt-4 text-neutral-600 dark:text-neutral-400 leading-relaxed">{t("landing.why.subtitle")}</p>
          <a href="#features" className="mt-6 inline-flex items-center gap-1.5 font-semibold text-indigo-600 hover:gap-2.5 transition-all">
            {t("landing.why.cta")} <ArrowRight size={16} />
          </a>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="landing-why">
          <Card icon={Target} title={t("landing.why.goals.t")} desc={t("landing.why.goals.d")}>
            <div className="flex items-center justify-between font-semibold text-[12px] text-neutral-800 dark:text-neutral-100">
              <span className="truncate">{t("landing.why.goals.okr")}</span>
              <span>62%</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
              <div className="h-full w-[62%] rounded-full bg-indigo-500" />
            </div>
            <ul className="mt-3 space-y-2 text-neutral-600 dark:text-neutral-300">
              {[
                [t("landing.why.goals.k1"), "bg-emerald-500", 2],
                [t("landing.why.goals.k2"), "bg-indigo-500", 1],
                [t("landing.why.goals.k3"), "bg-neutral-300 dark:bg-neutral-600", 0],
              ].map(([label, dot, n]) => (
                <li key={label as string} className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                  <span className="flex-1 truncate">{label}</span>
                  {Number(n) > 0 && <Faces n={Number(n)} />}
                </li>
              ))}
            </ul>
          </Card>

          <Card icon={BookOpen} title={t("landing.why.kb.t")} desc={t("landing.why.kb.d")}>
            <div className="flex gap-2.5 items-start">
              <span className="h-9 w-9 rounded-lg bg-white dark:bg-neutral-900 ring-1 ring-neutral-200 dark:ring-neutral-700 text-indigo-600 flex items-center justify-center shrink-0">
                <FileText size={17} strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-[12px] text-neutral-800 dark:text-neutral-100 truncate">{t("landing.why.kb.doc")}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {["SOP", "HR", t("landing.why.kb.tag")].map((x) => (
                    <span key={x} className="rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 text-[10px]">
                      {x}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <Faces n={3} more="+12" />
            </div>
          </Card>

          <Card icon={Database} title={t("landing.why.connected.t")} desc={t("landing.why.connected.d")}>
            <div className="relative h-[92px]">
              <svg viewBox="0 0 200 92" className="absolute inset-0 h-full w-full text-indigo-300 dark:text-indigo-800" preserveAspectRatio="none">
                <path d="M100 46 L38 18 M100 46 L162 18 M100 46 L38 74 M100 46 L162 74" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" fill="none" />
              </svg>
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center shadow-lg shadow-indigo-600/30">w</span>
              {[
                ["left-0 top-1", CheckSquare, t("landing.why.connected.task")],
                ["right-0 top-1", Target, "OKR"],
                ["left-0 bottom-1", BookOpen, "Wiki"],
                ["right-0 bottom-1", UserRound, t("landing.why.connected.people")],
              ].map(([pos, Icon, label]) => {
                const I = Icon as typeof Target;
                return (
                  <span key={label as string} className={`absolute ${pos} inline-flex items-center gap-1 rounded-lg bg-white dark:bg-neutral-900 ring-1 ring-neutral-200 dark:ring-neutral-700 px-2 py-1 text-[11px] text-neutral-700 dark:text-neutral-200`}>
                    <I size={12} className="text-indigo-600" /> {label as string}
                  </span>
                );
              })}
            </div>
          </Card>

          <Card icon={BarChart3} title={t("landing.why.views.t")} desc={t("landing.why.views.d")}>
            <p className="font-semibold text-[12px] text-neutral-800 dark:text-neutral-100">{t("landing.why.views.chart")}</p>
            <div className="mt-2 flex items-end gap-2.5 h-16">
              {[
                ["h-[30%]", "bg-emerald-400"],
                ["h-[70%]", "bg-indigo-400"],
                ["h-[22%]", "bg-neutral-200 dark:bg-neutral-700"],
                ["h-[55%]", "bg-indigo-200 dark:bg-indigo-900"],
                ["h-full", "bg-sky-300"],
              ].map(([h, c], i) => (
                <span key={i} className={`flex-1 rounded-md ${h} ${c}`} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-500">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-400" /> {t("landing.why.views.done")}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-indigo-400" /> {t("landing.why.views.progress")}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-300" /> {t("landing.why.views.todo")}</span>
            </div>
          </Card>

          <Card icon={Users} title={t("landing.why.teams.t")} desc={t("landing.why.teams.d")}>
            <Faces n={4} more="+5" />
            <ul className="mt-2.5 space-y-1.5">
              {[
                [Crown, t("role.owner"), t("landing.why.teams.owner")],
                [PenLine, t("role.editor"), t("landing.why.teams.editor")],
                [CheckSquare, t("role.contributor"), t("landing.why.teams.contributor")],
                [Eye, t("role.viewer"), t("landing.why.teams.viewer")],
              ].map(([Icon, role, what]) => {
                const I = Icon as typeof Crown;
                return (
                  <li key={role as string} className="grid grid-cols-[1fr_1fr] gap-2">
                    <span className="inline-flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-200">
                      <I size={11} className="text-indigo-500" /> {role as string}
                    </span>
                    <span className="text-neutral-500 truncate">{what as string}</span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card icon={Settings2} title={t("landing.why.yours.t")} desc={t("landing.why.yours.d")}>
            <div className="grid grid-cols-2 gap-1.5">
              <span className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-white dark:bg-neutral-900 ring-1 ring-indigo-300 dark:ring-indigo-800 py-1.5 font-medium text-neutral-800 dark:text-neutral-100">
                <Sun size={13} className="text-indigo-500" /> {t("landing.why.yours.light")}
              </span>
              <span className="inline-flex items-center justify-center gap-1.5 rounded-lg ring-1 ring-neutral-200 dark:ring-neutral-700 py-1.5 text-neutral-600 dark:text-neutral-300">
                <Moon size={13} /> {t("landing.why.yours.dark")}
              </span>
            </div>
            <div className="mt-2.5 flex items-center justify-between px-0.5">
              {["#f97316", "#6366f1", "#14b8a6", "#a855f7", "#3b82f6", "#10b981"].map((c) => (
                <span key={c} className="h-4 w-4 rounded-full ring-2 ring-white dark:ring-neutral-900 shadow" style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-1.5 rounded-lg ring-1 ring-neutral-200 dark:ring-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-neutral-700 dark:text-neutral-200">
              <Globe size={12} /> <span className="flex-1">{t("landing.why.yours.lang")}</span> <ChevronDown size={12} className="text-neutral-400" />
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- AI */

export function AiSection({ t }: { t: T }) {
  const cards = [
    { icon: FileText, t: t("landing.ai2.c1.t"), d: t("landing.ai2.c1.d"), a: [t("landing.ai2.c1.a1"), t("landing.ai2.c1.a2")] },
    { icon: Target, t: t("landing.ai2.c2.t"), d: t("landing.ai2.c2.d"), a: [t("landing.ai2.c2.a1"), t("landing.ai2.c2.a2")] },
    { icon: BookOpen, t: t("landing.ai2.c3.t"), d: t("landing.ai2.c3.d"), a: [t("landing.ai2.c3.a1"), t("landing.ai2.c3.a2")] },
    { icon: BarChart3, t: t("landing.ai2.c4.t"), d: t("landing.ai2.c4.d"), a: [t("landing.ai2.c4.a1"), t("landing.ai2.c4.a2")] },
  ];
  return (
    <section id="ai" className="scroll-mt-16 py-16 md:py-20 bg-gradient-to-b from-indigo-50/70 via-indigo-50/30 to-transparent dark:from-indigo-950/30 dark:via-indigo-950/10">
      <div className="max-w-[80rem] mx-auto px-4 grid gap-8 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)_minmax(0,20rem)] items-center">
        <div className="relative">
          <Badge>{t("landing.ai.badge")}</Badge>
          <h2 className="mt-4 text-3xl md:text-[2.5rem] font-bold tracking-tight leading-[1.1]">
            {t("landing.ai2.title1")} <span className="text-indigo-600">{t("landing.ai2.title2")}</span>
          </h2>
          <p className="mt-4 text-neutral-600 dark:text-neutral-400 leading-relaxed">{t("landing.ai2.subtitle")}</p>
          <a href="?auth=register#auth" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white font-semibold px-5 py-3 hover:bg-indigo-500 shadow-sm shadow-indigo-600/25">
            {t("landing.ai2.cta")} <ArrowRight size={16} />
          </a>
          <div className="mt-6 hidden lg:block w-[200px] ml-auto -mr-6">
            <Image src="/mascot/task-checklist.webp" alt={t("landing.mascot.task")} width={880} height={1060} sizes="200px" className="h-auto w-full select-none drop-shadow-[0_18px_24px_rgba(15,23,42,0.16)]" draggable={false} />
          </div>
        </div>

        <AiWindow t={t} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1" data-testid="landing-ai">
          {cards.map((c) => (
            <div key={c.t} className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex gap-3">
                <IconTile icon={c.icon} />
                <div className="min-w-0">
                  <h3 className="font-semibold text-[15px] leading-tight">{c.t}</h3>
                  <p className="mt-1 text-[13px] leading-snug text-neutral-600 dark:text-neutral-400">{c.d}</p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {c.a.map((x) => (
                      <span key={x} className="inline-flex items-center gap-1 rounded-full border border-indigo-200/80 dark:border-indigo-900 bg-indigo-50/70 dark:bg-indigo-950/40 px-2.5 py-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                        <Sparkles size={10} /> {x}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AiWindow({ t }: { t: T }) {
  const rail = [Plus, Search, FolderClosed, ListChecks, Link2, BookOpen, Target];
  return (
    <div className="min-w-0 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-2xl shadow-neutral-900/10 overflow-hidden text-[11px]" aria-hidden="true" data-testid="landing-ai-window">
      <div className="flex items-center gap-1.5 px-3 h-8 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
      </div>
      <div className="flex">
        <div className="hidden sm:flex w-10 shrink-0 flex-col items-center gap-3.5 py-3 border-r border-neutral-100 dark:border-neutral-800 text-neutral-400">
          <span className="text-indigo-600 font-black text-sm leading-none">w</span>
          {rail.map((I, i) => (
            <I key={i} size={13} strokeWidth={1.75} />
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="px-4 pt-3 pb-2 border-b border-neutral-100 dark:border-neutral-800">
            <p className="font-semibold text-[13px] text-neutral-900 dark:text-neutral-50">Woli AI</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate text-[10px] text-neutral-400">
                Wiki <ChevronRight size={9} className="inline" /> HR <ChevronRight size={9} className="inline" /> {t("landing.why.kb.doc")}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md ring-1 ring-neutral-200 dark:ring-neutral-700 px-1.5 py-0.5"><Share2 size={10} /> {t("landing.ai2.w.share")}</span>
              <span className="inline-flex items-center gap-1 rounded-md ring-1 ring-neutral-200 dark:ring-neutral-700 px-1.5 py-0.5"><Sparkles size={10} className="text-indigo-500" /> {t("landing.ai2.w.ask")}</span>
              <span className="hidden md:inline-flex rounded-md ring-1 ring-neutral-200 dark:ring-neutral-700 px-1 py-0.5"><MoreHorizontal size={10} /></span>
            </div>
          </div>
          <div className="grid md:grid-cols-[1fr_minmax(0,14rem)]">
            <div className="relative p-4 min-w-0">
              <p className="flex items-center gap-2 font-semibold text-[13px] text-neutral-900 dark:text-neutral-50">
                <FileText size={15} className="text-indigo-600" /> {t("landing.why.kb.doc")}
              </p>
              <p className="mt-3 leading-relaxed text-neutral-700 dark:text-neutral-300">
                <mark className="bg-indigo-100/80 dark:bg-indigo-900/50 text-inherit rounded px-0.5">{t("landing.ai2.w.highlight")}</mark>
              </p>
              <p className="mt-4 font-semibold text-neutral-900 dark:text-neutral-100">{t("landing.ai2.w.section")}</p>
              <ul className="mt-2 space-y-2 text-neutral-600 dark:text-neutral-300">
                {[t("landing.ai2.w.s1"), t("landing.ai2.w.s2"), t("landing.ai2.w.s3"), t("landing.ai2.w.s4")].map((x) => (
                  <li key={x} className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-[4px] ring-1 ring-neutral-300 dark:ring-neutral-600" /> {x}
                  </li>
                ))}
              </ul>
              {/* Selection menu, as in the app */}
              <div className="hidden sm:block absolute right-2 top-[42%] w-44 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl p-1">
                {[
                  [Sparkles, t("landing.ai2.m.ask")],
                  [CheckSquare, t("landing.ai2.m.task")],
                  [Repeat, t("landing.ai2.m.recurring")],
                  [Target, t("landing.ai2.m.okr")],
                  [Copy, t("landing.ai2.m.link")],
                ].map(([Icon, label], i) => {
                  const I = Icon as typeof Sparkles;
                  return (
                    <span key={label as string} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${i === 0 ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300" : "text-neutral-700 dark:text-neutral-300"}`}>
                      <I size={11} /> {label as string}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="hidden md:flex flex-col border-l border-neutral-100 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/30 p-3 gap-2.5">
              <p className="flex items-center gap-1.5 font-semibold text-neutral-800 dark:text-neutral-100">
                <Sparkles size={11} className="text-indigo-500" /> {t("landing.ai2.w.ask")} <X size={11} className="ml-auto text-neutral-400" />
              </p>
              <span className="self-end rounded-xl rounded-br-sm bg-indigo-100/80 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200 px-2.5 py-1.5 font-medium">{t("landing.ai2.w.q")}</span>
              <div className="rounded-xl bg-white dark:bg-neutral-900 ring-1 ring-neutral-200 dark:ring-neutral-800 p-2.5 text-neutral-600 dark:text-neutral-300 leading-relaxed">
                <p>{t("landing.ai2.w.a")}</p>
                <p className="mt-2 font-semibold text-neutral-800 dark:text-neutral-100">{t("landing.ai2.w.key")}</p>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {[t("landing.ai2.w.s1"), t("landing.ai2.w.k2"), t("landing.ai2.w.k3"), t("landing.ai2.w.s4")].map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              <span className="mt-auto flex items-center gap-2 rounded-full bg-white dark:bg-neutral-900 ring-1 ring-neutral-200 dark:ring-neutral-800 pl-3 pr-1 py-1 text-neutral-400">
                <span className="flex-1 truncate">{t("landing.ai2.w.follow")}</span>
                <span className="h-5 w-5 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                  <Send size={10} />
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Steps */

export function GetStarted({ t }: { t: T }) {
  const steps = [
    { icon: UserPlus, t: t("landing.guide.s1.t"), d: t("landing.guide.s1.short") },
    { icon: Building2, t: t("landing.guide.s2.t"), d: t("landing.guide.s2.short") },
    { icon: Users, t: t("landing.guide.s3.t"), d: t("landing.guide.s3.short") },
    { icon: FolderClosed, t: t("landing.guide.s4.t"), d: t("landing.guide.s4.short") },
    { icon: BarChart3, t: t("landing.guide.s5.t"), d: t("landing.guide.s5.short") },
  ];
  return (
    <section id="guide" className="scroll-mt-16 py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-4">
        <Badge>{t("landing.guide.badge")}</Badge>
        <h2 className="mt-4 text-3xl md:text-[2.5rem] font-bold tracking-tight leading-[1.1]">{t("landing.guide.title")}</h2>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">{t("landing.guide.subtitle")}</p>
        <ol className="mt-10 grid gap-x-3 gap-y-8 sm:grid-cols-2 lg:grid-cols-5" data-testid="landing-steps">
          {steps.map((s, i) => (
            <li key={s.t} className="relative">
              <div className="h-full rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 pt-7 pb-5 px-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <span className="absolute -top-4 left-5 h-9 w-9 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center shadow-md shadow-indigo-600/30 ring-4 ring-white dark:ring-neutral-950">{i + 1}</span>
                <s.icon size={20} strokeWidth={1.75} className="text-indigo-600" />
                <h3 className="mt-3 font-semibold">{s.t}</h3>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400 leading-snug">{s.d}</p>
              </div>
              {i < steps.length - 1 && (
                <ChevronRight size={16} className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 text-indigo-300 dark:text-indigo-800 z-10" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
