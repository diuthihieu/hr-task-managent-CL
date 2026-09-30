"use client";
// Knowledge health: problems found in the knowledge base, each with a
// suggested fix the user applies (the AI / checks never change anything).
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Sparkles, HeartPulse, BadgeCheck, Archive, Clock, Eraser, Compass, Link2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Card, EmptyNote } from "./brain-hub";
import type { MessageKey } from "@/lib/i18n/core";

interface Issue {
  type: string;
  pageId: string;
  title: string;
  href?: string;
  detail: Record<string, string | number | null>;
  suggestion: string;
  severity: "high" | "medium" | "low";
}
interface Health {
  pageCount: number;
  counts: Record<string, number>;
  issues: Issue[];
}
interface Conflict {
  a: { id: string; title: string; href?: string };
  b: { id: string; title: string; href?: string };
  issue: string;
  quoteA: string;
  quoteB: string;
  suggestion: string;
}
const TYPES = ["broken_link", "outdated", "stale_reference", "duplicate", "missing_source", "unlinked", "never_revisited"] as const;
/** Findings grouped by what they cost the team: wrong answers, clutter, or knowledge nobody finds. */
const GROUPS = [
  { key: "attention", types: ["broken_link", "outdated", "stale_reference"] as string[], icon: AlertTriangle, tone: "text-red-600 bg-red-50 dark:bg-red-950/40", bar: "bg-red-500" },
  { key: "cleanup", types: ["duplicate", "missing_source"] as string[], icon: Eraser, tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40", bar: "bg-indigo-500" },
  { key: "discover", types: ["unlinked", "never_revisited"] as string[], icon: Compass, tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40", bar: "bg-indigo-500" },
];

export function HealthReport({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const [data, setData] = useState<Health | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [group, setGroup] = useState<string>("");
  const [conflicts, setConflicts] = useState<{ checkedPairs: number; conflicts: Conflict[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const load = () => api.get<Health>(`/api/workspaces/${workspaceId}/brain/health`).then(setData).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per workspace
  }, [workspaceId]);

  async function apply(i: Issue, patch: Record<string, unknown>) {
    if (patch.status === "archived" && !confirm(t("brain.health.confirmArchive", { title: i.title }))) return;
    try {
      await api.patch(`/api/wiki/${i.pageId}`, patch);
      toast.success(t("brain.health.applied"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  async function checkConflicts() {
    setChecking(true);
    try {
      setConflicts(await api.post(`/api/workspaces/${workspaceId}/brain/health/conflicts`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setChecking(false);
    }
  }

  if (!data)
    return (
      <div className="py-10 flex justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  const shown = data.issues.filter((i) => !filter || i.type === filter);
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const score = data.pageCount ? Math.max(0, Math.round(100 - (new Set(data.issues.filter((i) => i.severity !== "low").map((i) => i.pageId)).size / data.pageCount) * 100)) : 100;
  return (
    <div className="space-y-4" data-testid="health">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3 flex items-center gap-3">
          <HeartPulse size={22} className={score >= 80 ? "text-indigo-600" : score >= 50 ? "text-indigo-600" : "text-red-600"} />
          <div>
            <p className="text-2xl font-bold tabular-nums leading-none" data-testid="health-score">{score}</p>
            <p className="text-[11px] text-neutral-500 mt-1">{t("brain.health.score", { pages: data.pageCount, issues: total })}</p>
          </div>
        </div>
        {GROUPS.map((g) => {
          const n = g.types.reduce((a, k) => a + (data.counts[k] ?? 0), 0);
          return (
            <button key={g.key} onClick={() => { setGroup(group === g.key ? "" : g.key); setFilter(""); }} className={cn("text-left rounded-2xl border bg-white dark:bg-neutral-900 px-4 py-3 transition-colors", group === g.key ? "border-indigo-500 ring-2 ring-indigo-500/20" : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300")} data-testid={`health-group-${g.key}`}>
              <div className="flex items-center gap-2">
                <span className={cn("h-7 w-7 rounded-lg flex items-center justify-center", g.tone)}>
                  <g.icon size={14} />
                </span>
                <span className="text-sm font-semibold">{t(`brain.health.group.${g.key}` as MessageKey)}</span>
                <span className="ml-auto text-lg font-bold tabular-nums">{n}</span>
              </div>
              <p className="mt-1.5 text-[11px] text-neutral-500 leading-snug">{t(`brain.health.groupWhy.${g.key}` as MessageKey)}</p>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setFilter("")} className={cn("h-7 px-2.5 rounded-full border text-xs", !filter ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-300 dark:border-neutral-700")}>
          {t("graph.showAll")} {total}
        </button>
        {TYPES.filter((k) => !group || GROUPS.find((g) => g.key === group)!.types.includes(k)).map((k) => (
          <button key={k} onClick={() => setFilter(filter === k ? "" : k)} className={cn("h-7 px-2.5 rounded-full border text-xs", filter === k ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-300 dark:border-neutral-700")} data-testid={`health-filter-${k}`}>
            {t(`brain.health.type.${k}` as MessageKey)} <span className="tabular-nums opacity-70">{data.counts[k] ?? 0}</span>
          </button>
        ))}
        <Button variant="outline" size="sm" className="ml-auto" onClick={checkConflicts} disabled={checking} data-testid="health-conflicts">
          {checking ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {t("brain.health.checkConflicts")}
        </Button>
      </div>
      <p className="text-[11px] text-neutral-500">{t("brain.health.policy")}</p>

      {conflicts && (
        <Card title={t("brain.health.conflicts", { n: conflicts.conflicts.length, pairs: conflicts.checkedPairs })} icon={<AlertTriangle size={15} className="text-red-600" />} testId="health-conflict-list">
          {conflicts.conflicts.length ? (
            conflicts.conflicts.map((c, i) => (
              <div key={i} className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-2.5 mb-2 text-xs space-y-1">
                <p className="font-medium text-sm">{c.issue}</p>
                <p>
                  <Link href={c.a.href ?? "#"} className="text-indigo-600 hover:underline">{c.a.title}</Link>: “{c.quoteA}”
                </p>
                <p>
                  <Link href={c.b.href ?? "#"} className="text-indigo-600 hover:underline">{c.b.title}</Link>: “{c.quoteB}”
                </p>
                <p className="text-neutral-500">💡 {c.suggestion}</p>
              </div>
            ))
          ) : (
            <EmptyNote text={t("brain.health.noConflicts")} />
          )}
        </Card>
      )}

      {!shown.length && (
        <div className="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 p-6 text-center">
          <BadgeCheck size={22} className="mx-auto text-indigo-500" />
          <p className="mt-1 text-sm font-medium">{t("brain.health.clean")}</p>
          <p className="text-xs text-neutral-500">{t("brain.health.cleanHint")}</p>
        </div>
      )}
      {GROUPS.filter((g) => !group || g.key === group).map((g) => {
        const items = shown.filter((i) => g.types.includes(i.type));
        if (!items.length) return null;
        return (
          <section key={g.key} className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden" data-testid={`health-section-${g.key}`}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-neutral-100 dark:border-neutral-800">
              <span className={cn("h-1.5 w-6 rounded-full", g.bar)} />
              <h3 className="text-sm font-semibold">{t(`brain.health.group.${g.key}` as MessageKey)}</h3>
              <span className="text-xs text-neutral-400">{items.length}</span>
              <span className="ml-auto text-[11px] text-neutral-500 hidden md:inline">{t(`brain.health.groupAction.${g.key}` as MessageKey)}</span>
            </div>
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {items.map((i, n) => (
                <li key={`${i.type}${i.pageId}${n}`} className="flex flex-wrap md:flex-nowrap items-center gap-2 px-4 py-2 text-sm" data-testid="health-issue">
                  <span className={cn("h-2 w-2 rounded-full shrink-0", i.severity === "high" ? "bg-red-500" : i.severity === "medium" ? "bg-amber-500" : "bg-neutral-300")} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 min-w-0">
                      <Link href={i.href ?? "#"} className="font-medium truncate hover:text-indigo-600">
                        {i.title}
                      </Link>
                      <span className="text-[10px] uppercase tracking-wide text-neutral-400 shrink-0">{t(`brain.health.type.${i.type}` as MessageKey)}</span>
                    </p>
                    <p className="text-xs text-neutral-500 truncate">
                      {describe(i, t)}
                      <span className="ml-3 text-neutral-400">{t(`brain.health.suggest.${i.suggestion}` as MessageKey)}</span>
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-[11px] shrink-0">
                    {(i.type === "broken_link" || i.type === "stale_reference" || i.type === "unlinked") && (
                      <Link href={i.href ?? "#"} className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-indigo-600 text-white">
                        <Link2 size={11} /> {t(i.type === "unlinked" ? "brain.health.addLinks" : "brain.health.fixLink")}
                      </Link>
                    )}
                    {(i.type === "outdated" || i.type === "never_revisited" || i.type === "missing_source") && (
                      <button onClick={() => apply(i, { markChecked: true, ...(i.detail.reason === "marked" ? { status: "current" } : {}) })} className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800" data-testid="health-mark-checked">
                        <BadgeCheck size={11} /> {t("brain.props.markChecked")}
                      </button>
                    )}
                    {i.type === "outdated" && i.detail.reason !== "marked" && (
                      <button onClick={() => apply(i, { status: "outdated" })} className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                        <Clock size={11} /> {t("brain.health.markOutdated")}
                      </button>
                    )}
                    {(i.type === "outdated" || i.type === "duplicate") && (
                      <button onClick={() => apply(i, { status: "archived" })} className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                        <Archive size={11} /> {t("brain.health.archive")}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function describe(i: Issue, t: ReturnType<typeof useT>["t"]) {
  const d = i.detail;
  switch (i.type) {
    case "outdated":
      return d.reason === "expired" ? t("brain.health.d.expired", { date: String(d.validTo) }) : d.reason === "stale" ? t("brain.health.d.stale", { date: String(d.updatedAt) }) : t("brain.health.d.marked");
    case "duplicate":
      return t("brain.health.d.duplicate", { other: String(d.other) });
    case "broken_link":
      return t(d.target === "block" ? "brain.health.d.brokenBlock" : "brain.health.d.broken", { text: String(d.text || "?") });
    case "stale_reference":
      return t("brain.health.d.staleRef", { other: String(d.other) });
    case "never_revisited":
      return d.lastViewedAt ? t("brain.health.d.lastViewed", { date: String(d.lastViewedAt) }) : t("brain.health.d.neverViewed");
    case "missing_source":
      return t("brain.health.d.missingSource", { type: t(`brain.source.${d.sourceType}` as MessageKey) });
    default:
      return t("brain.health.d.unlinked");
  }
}
