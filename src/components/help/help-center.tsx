"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Rocket, Home, ListChecks, Inbox, Sparkles, Bot, Brain, BarChart3, Target, Award, BookOpen, FolderKanban, Table2, FileText, SlidersHorizontal, Settings, Keyboard, LifeBuoy, Search, ArrowUpRight, Lightbulb, CircleHelp, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";
import { HELP_TABS, searchHelp, type Bi, type HelpIcon, type HelpTab, type HelpTopic } from "@/lib/help/content";

const ICONS: Record<HelpIcon, React.ComponentType<{ size?: number; className?: string }>> = {
  rocket: Rocket, home: Home, list: ListChecks, inbox: Inbox, sparkles: Sparkles, bot: Bot, brain: Brain, chart: BarChart3, target: Target, award: Award, book: BookOpen, folder: FolderKanban, table: Table2, file: FileText, sliders: SlidersHorizontal, settings: Settings, keyboard: Keyboard, life: LifeBuoy,
};

/**
 * Help center: one tab per feature group (following the main menu), each with
 * expandable topics (steps + tips), a search across every tab and deep links
 * (?tab=…&topic=…) so a topic can be shared.
 */
export function HelpCenter({ workspaceSlug, initialTab, initialTopic }: { workspaceSlug: string; initialTab?: string; initialTopic?: string }) {
  const { t, locale } = useT();
  const router = useRouter();
  const L = (b: Bi) => (locale === "vi" ? b[1] : b[0]);
  const [tabId, setTabId] = useState(HELP_TABS.some((x) => x.id === initialTab) ? initialTab! : HELP_TABS[0].id);
  const [open, setOpen] = useState<string | null>(initialTopic ?? null);
  const [query, setQuery] = useState("");
  const tab = HELP_TABS.find((x) => x.id === tabId) ?? HELP_TABS[0];
  const results = useMemo(() => searchHelp(query), [query]);
  const base = `/w/${workspaceSlug}`;

  // Keep the address in sync so a tab / topic can be bookmarked or shared.
  useEffect(() => {
    const q = new URLSearchParams({ tab: tabId });
    if (open) q.set("topic", open);
    router.replace(`${base}/help?${q}`, { scroll: false });
  }, [tabId, open, base, router]);

  // Phones: keep the active tab chip in view in its scrolling row.
  useEffect(() => {
    document.querySelector(`[data-help-chip="${tabId}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [tabId]);

  // A deep-linked topic scrolls into view once.
  useEffect(() => {
    if (initialTopic) document.getElementById(`help-${initialTab}-${initialTopic}`)?.scrollIntoView({ block: "start" });
  }, [initialTab, initialTopic]);

  const goTo = (tabKey: string, topic?: string) => {
    setTabId(tabKey);
    setOpen(topic ?? null);
    setQuery("");
    if (topic) requestAnimationFrame(() => document.getElementById(`help-${tabKey}-${topic}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  return (
    <div className="flex-1 flex overflow-hidden" data-testid="help-center">
      <aside className="hidden md:flex w-60 shrink-0 border-r border-neutral-200 dark:border-neutral-800 flex-col overflow-hidden">
        <div className="flex items-center gap-2 h-12 px-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <CircleHelp size={15} className="text-indigo-500" />
          <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{t("help.title")}</h1>
        </div>
        <nav className="flex-1 overflow-y-auto thin-scroll p-2 space-y-px" aria-label={t("help.title")}>
          {HELP_TABS.map((x) => {
            const Icon = ICONS[x.icon];
            return (
              <button
                key={x.id}
                onClick={() => goTo(x.id)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left",
                  x.id === tab.id && !query ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                )}
                data-testid={`help-tab-${x.id}`}
                aria-current={x.id === tab.id ? "page" : undefined}
              >
                <Icon size={14} className="shrink-0" />
                <span className="truncate">{L(x.title)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 overflow-y-auto thin-scroll">
        <div className="sticky top-0 z-10 bg-white/95 dark:bg-neutral-950/95 backdrop-blur border-b border-neutral-200 dark:border-neutral-800 px-4 sm:px-6 py-2.5 space-y-2">
          <div className="relative max-w-xl">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value.slice(0, 120))}
              placeholder={t("help.search")}
              className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 pl-8 pr-8 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40"
              data-testid="help-search"
              aria-label={t("help.search")}
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700" aria-label={t("common.close")}>
                <X size={14} />
              </button>
            )}
          </div>
          {/* Phones and tablets: tabs as a scrolling row. */}
          <div className="md:hidden flex gap-1.5 overflow-x-auto thin-scroll pb-0.5" data-testid="help-tabs-mobile">
            {HELP_TABS.map((x) => (
              <button
                key={x.id}
                onClick={() => goTo(x.id)}
                data-help-chip={x.id}
                className={cn("shrink-0 rounded-full border px-3 py-1 text-xs", x.id === tab.id && !query ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300")}
              >
                {L(x.title)}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 sm:px-6 py-5 max-w-3xl">
          {query ? (
            <section data-testid="help-results">
              <p className="text-xs text-neutral-500 mb-3">{t("help.results", { n: results.length })}</p>
              {results.length === 0 && <p className="text-sm text-neutral-500">{t("help.noResults")}</p>}
              <ul className="space-y-2">
                {results.map(({ tab: rt, topic }) => (
                  <li key={`${rt.id}-${topic.id}`}>
                    <button onClick={() => goTo(rt.id, topic.id)} className="w-full text-left rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 hover:border-indigo-300 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30" data-testid="help-result">
                      <div className="text-[11px] text-neutral-400">{L(rt.title)}</div>
                      <div className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{L(topic.title)}</div>
                      <div className="text-xs text-neutral-500 line-clamp-2 mt-0.5">{L(topic.body)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <TabView tab={tab} L={L} base={base} open={open} setOpen={setOpen} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabView({ tab, L, base, open, setOpen }: { tab: HelpTab; L: (b: Bi) => string; base: string; open: string | null; setOpen: (id: string | null) => void }) {
  const { t } = useT();
  const Icon = ICONS[tab.icon];
  return (
    <section data-testid={`help-panel-${tab.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <span className="h-9 w-9 shrink-0 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 flex items-center justify-center">
            <Icon size={18} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{L(tab.title)}</h2>
            <p className="text-sm text-neutral-500">{L(tab.intro)}</p>
          </div>
        </div>
        {tab.path !== undefined && (
          <Link href={`${base}${tab.path}`} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 dark:border-neutral-700 px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-300 hover:border-indigo-300 hover:text-indigo-600" data-testid="help-open-feature">
            {t("help.open")} <ArrowUpRight size={12} />
          </Link>
        )}
      </div>
      <div className="space-y-2">
        {tab.topics.map((topic) => (
          <TopicCard key={topic.id} tabId={tab.id} topic={topic} L={L} open={open === topic.id} toggle={() => setOpen(open === topic.id ? null : topic.id)} />
        ))}
      </div>
    </section>
  );
}

function TopicCard({ tabId, topic, L, open, toggle }: { tabId: string; topic: HelpTopic; L: (b: Bi) => string; open: boolean; toggle: () => void }) {
  const { t } = useT();
  return (
    <article id={`help-${tabId}-${topic.id}`} className={cn("scroll-mt-28 rounded-lg border bg-white dark:bg-neutral-900", open ? "border-indigo-300 dark:border-indigo-800" : "border-neutral-200 dark:border-neutral-800")} data-testid="help-topic">
      <button onClick={toggle} className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left" aria-expanded={open} data-testid={`help-topic-${topic.id}`}>
        <span>
          <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-50">{L(topic.title)}</span>
          {!open && <span className="block text-xs text-neutral-500 line-clamp-1 mt-0.5">{L(topic.body)}</span>}
        </span>
        <span className={cn("mt-0.5 text-neutral-400 transition-transform", open && "rotate-45")} aria-hidden>
          +
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
          <p>{L(topic.body)}</p>
          {topic.steps?.length ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">{t("help.steps")}</div>
              <ol className="space-y-1.5">
                {topic.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="h-5 w-5 shrink-0 rounded-full bg-indigo-600 text-white text-[11px] font-semibold flex items-center justify-center">{i + 1}</span>
                    <span>{L(s)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {topic.tips?.map((tip, i) => (
            <p key={i} className="flex gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-900 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              <Lightbulb size={14} className="shrink-0 mt-px" />
              <span>{L(tip)}</span>
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
