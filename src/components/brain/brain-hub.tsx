"use client";
// Work Second Brain hub: Capture -> Structure -> Connect -> Understand -> Act
// -> Learn -> Resurface, in one place.
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Brain, Sparkles, NotebookPen, Gavel, HeartPulse, CalendarRange, Sun, Waypoints } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { ForYou } from "./for-you";
import { AskBrain } from "./ask-brain";
import { Journal } from "./journal";
import { DecisionsList } from "./decisions-list";
import { HealthReport } from "./health-report";
import { WeeklyReview } from "./weekly-review";
import type { MessageKey } from "@/lib/i18n/core";

const TABS = [
  { key: "today", icon: Sun },
  { key: "ask", icon: Sparkles },
  { key: "journal", icon: NotebookPen },
  { key: "decisions", icon: Gavel },
  { key: "health", icon: HeartPulse },
  { key: "weekly", icon: CalendarRange },
] as const;
export type BrainTab = (typeof TABS)[number]["key"];

export function BrainHub({ workspaceId, workspaceSlug, tab }: { workspaceId: string; workspaceSlug: string; tab: BrainTab }) {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const go = (k: BrainTab) => {
    const q = new URLSearchParams(params.toString());
    q.set("tab", k);
    router.replace(`/w/${workspaceSlug}/brain?${q.toString()}`);
  };
  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className="max-w-[68.75rem] mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-neutral-900 dark:text-neutral-50 inline-flex items-center gap-2">
              <Brain size={22} className="text-indigo-600" /> {t("brain.title")}
            </h1>
            <p className="text-sm text-neutral-500 mt-0.5">{t("brain.subtitle")}</p>
          </div>
          <Link href={`/w/${workspaceSlug}/wiki/graph`} className="h-8 px-3 text-sm gap-1.5 inline-flex items-center rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800">
            <Waypoints size={14} /> {t("graph.open")}
          </Link>
        </div>
        <div className="flex gap-1 overflow-x-auto thin-scroll border-b border-neutral-200 dark:border-neutral-800 mb-5" role="tablist">
          {TABS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => go(key)}
              className={cn("h-9 px-3 text-sm font-medium inline-flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap", tab === key ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")}
              data-testid={`brain-tab-${key}`}
            >
              <Icon size={14} /> {t(`brain.tab.${key}` as MessageKey)}
            </button>
          ))}
        </div>
        {tab === "today" && <ForYou workspaceId={workspaceId} />}
        {tab === "ask" && <AskBrain workspaceId={workspaceId} />}
        {tab === "journal" && <Journal workspaceId={workspaceId} />}
        {tab === "decisions" && <DecisionsList workspaceId={workspaceId} />}
        {tab === "health" && <HealthReport workspaceId={workspaceId} />}
        {tab === "weekly" && <WeeklyReview workspaceId={workspaceId} />}
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
