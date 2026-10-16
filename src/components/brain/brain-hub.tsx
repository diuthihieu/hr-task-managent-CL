"use client";
// Work Second Brain hub: Capture -> Structure -> Connect -> Understand -> Act
// -> Learn -> Resurface, in one place.
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Brain, Sparkles, NotebookPen, Gavel, HeartPulse, Sun, Waypoints, BookOpen } from "lucide-react";
import { KnowledgeGraphView } from "@/components/graph/knowledge-graph-view";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { ForYou } from "./for-you";
import { AskBrain } from "./ask-brain";
import { Journal } from "./journal";
import { DecisionsList } from "./decisions-list";
import { HealthReport } from "./health-report";
import { WeeklyReview } from "./weekly-review";
import type { MessageKey } from "@/lib/i18n/core";

// Grouped by the job: discover what matters now, recall what happened, and
// keep the knowledge memory healthy and connected.
// Home = daily intelligence + week / month / year reviews; Journal & Decisions = what
// happened and what was decided.
const TABS = [
  { key: "home", icon: Sun, group: "discover", label: "brain.tab.home" },
  { key: "ask", icon: Sparkles, group: "discover", label: "brain.tab.ask" },
  { key: "journal", icon: NotebookPen, group: "recall", label: "brain.tab.journalDecisions" },
  { key: "graph", icon: Waypoints, group: "memory", label: "brain.tab.graph" },
  { key: "health", icon: HeartPulse, group: "memory", label: "brain.tab.health" },
] as const;
export type BrainTab = (typeof TABS)[number]["key"];
export type BrainPeriod = "day" | "week" | "month" | "year";
const PERIODS: BrainPeriod[] = ["day", "week", "month", "year"];
const PERIOD_KEY = "woli.brain.period";

export function BrainHub({ workspaceId, workspaceSlug, tab, period: periodParam, view }: { workspaceId: string; workspaceSlug: string; tab: BrainTab; period?: BrainPeriod; view?: "journal" | "decisions" }) {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const go = (k: BrainTab, extra?: Record<string, string>) => {
    const q = new URLSearchParams(params.toString());
    q.set("tab", k);
    for (const [key, v] of Object.entries(extra ?? {})) q.set(key, v);
    router.replace(`/w/${workspaceSlug}/brain?${q.toString()}`);
  };
  // The Home period is a personal view setting: the link wins, else the last choice on this device.
  const [savedPeriod] = useState<BrainPeriod>(() => {
    try {
      const v = typeof window !== "undefined" ? (window.localStorage.getItem(PERIOD_KEY) as BrainPeriod | null) : null;
      return v && PERIODS.includes(v) ? v : "day";
    } catch {
      return "day";
    }
  });
  const period = periodParam ?? savedPeriod;
  const setPeriod = (p: BrainPeriod) => {
    try {
      window.localStorage.setItem(PERIOD_KEY, p);
    } catch {
      /* private mode: the URL still carries it */
    }
    go("home", { period: p });
  };
  const jdView = view ?? "journal";
  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className={cn("mx-auto px-4 sm:px-6 py-5", tab === "graph" ? "max-w-[90rem]" : "max-w-[72rem]")}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 inline-flex items-center gap-2">
              <Brain size={20} className="text-indigo-600" /> {t("brain.title")}
            </h1>
            <p className="text-xs text-neutral-500 mt-0.5">{t("brain.subtitle2")}</p>
          </div>
          <Link href={`/w/${workspaceSlug}/wiki`} className="h-8 px-3 text-xs gap-1.5 inline-flex items-center rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800" title={t("brain.wikiHint")}>
            <BookOpen size={13} /> {t("brain.writeInWiki")}
          </Link>
        </div>
        <div className="flex items-end gap-1 overflow-x-auto thin-scroll border-b border-neutral-200 dark:border-neutral-800 mb-4" role="tablist">
          {TABS.map(({ key, icon: Icon, group, label }, i) => (
            <span key={key} className="flex items-end">
              {i > 0 && TABS[i - 1].group !== group && <span className="self-center mx-1.5 h-4 w-px bg-neutral-200 dark:bg-neutral-700" aria-hidden />}
              <button
                role="tab"
                aria-selected={tab === key}
                onClick={() => go(key)}
                title={t(`brain.group.${group}` as MessageKey)}
                className={cn("h-9 px-3 text-sm font-medium inline-flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap", tab === key ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")}
                data-testid={`brain-tab-${key}`}
              >
                <Icon size={14} /> {t(label as MessageKey)}
              </button>
            </span>
          ))}
        </div>
        {tab === "home" && (
          <div className="space-y-4" data-testid="brain-home">
            <Segmented label={t("brain.period.label")} value={period} options={PERIODS.map((p) => ({ value: p, label: t(`brain.period.${p}`) }))} onChange={setPeriod} testId="brain-period" />
            {period === "day" ? <ForYou workspaceId={workspaceId} /> : <WeeklyReview key={period} workspaceId={workspaceId} period={period} />}
          </div>
        )}
        {tab === "ask" && <AskBrain workspaceId={workspaceId} />}
        {tab === "journal" && (
          <div className="space-y-4" data-testid="brain-journal-decisions">
            <Segmented value={jdView} options={[{ value: "journal", label: t("brain.jd.journal"), icon: <NotebookPen size={13} /> }, { value: "decisions", label: t("brain.jd.decisions"), icon: <Gavel size={13} /> }]} onChange={(v) => go("journal", { view: v })} testId="brain-jd" />
            {jdView === "decisions" ? <DecisionsList workspaceId={workspaceId} /> : <Journal workspaceId={workspaceId} />}
          </div>
        )}
        {tab === "health" && <HealthReport workspaceId={workspaceId} />}
        {tab === "graph" && (
          <div className="h-[calc(100dvh-13rem)] min-h-[28rem] flex flex-col rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden" data-testid="brain-graph">
            <KnowledgeGraphView workspaceId={workspaceId} embedded />
          </div>
        )}
      </div>
    </div>
  );
}

/** Pill switch (Home period, Journal / Decisions). */
function Segmented<T extends string>({ label, value, options, onChange, testId }: { label?: string; value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testId}>
      {label && <span className="text-xs font-medium text-neutral-500">{label}</span>}
      <div className="inline-flex rounded-lg border border-neutral-200 dark:border-neutral-700 p-0.5 bg-neutral-50 dark:bg-neutral-900" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn("h-7 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5", value === o.value ? "bg-white dark:bg-neutral-800 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")}
            data-testid={testId ? `${testId}-${o.value}` : undefined}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Small list-card used across the hub. */
export function Card({ title, icon, children, testId, action }: { title: string; icon?: React.ReactNode; children: React.ReactNode; testId?: string; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4" data-testid={testId}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

export function ItemRow({ href, title, sub, extra, testId }: { href?: string; title: string; sub?: string | null; extra?: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 text-sm" data-testid={testId}>
      {href ? (
        <Link href={href} target={href.startsWith("/api/") ? "_blank" : undefined} className="truncate text-neutral-800 dark:text-neutral-100 hover:text-indigo-600">
          {title}
        </Link>
      ) : (
        <span className="truncate">{title}</span>
      )}
      {sub && <span className="text-[11px] text-neutral-400 truncate">{sub}</span>}
      {extra && <span className="ml-auto shrink-0">{extra}</span>}
    </div>
  );
}

export function EmptyNote({ text }: { text: string }) {
  return <p className="px-2 py-2 text-xs text-neutral-500">{text}</p>;
}
