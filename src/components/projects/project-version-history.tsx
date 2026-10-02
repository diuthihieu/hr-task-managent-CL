"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock3, Pencil, Plus, RotateCcw, Trash2, UserRound } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { MetaChip } from "@/components/ui/meta";
import { useT } from "@/components/i18n-provider";
import { InlineArrow } from "@/components/ui/inline-arrow";

interface VersionEvent {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: string | null;
  changes: Record<string, { from?: unknown; to?: unknown }> | null;
  createdAt: string;
  actor: { id: string; name: string; avatarColor: string } | null;
}
interface VersionResponse { allowedDays: number; events: VersionEvent[] }

const ACTION_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = { created: Plus, deleted: Trash2, restored: RotateCcw, assigned: UserRound };

export function ProjectVersionHistory({ projectId }: { projectId: string }) {
  const { t } = useT();
  const [rows, setRows] = useState<VersionEvent[]>([]);
  const [allowedDays, setAllowedDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    try {
      const response = await api.get<VersionResponse>(`/api/projects/${projectId}/history?limit=100${before ? `&before=${encodeURIComponent(before)}` : ""}`);
      setAllowedDays(response.allowedDays);
      setRows((current) => before ? [...current, ...response.events] : response.events);
      setDone(response.events.length < 100);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the permission-filtered project history from its authenticated API
  useEffect(() => { void load(); }, [load]);

  if (error) return <div className="m-5 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><h2 className="font-semibold">{t("vh.unavailable")}</h2><p className="mt-1">{error}</p></div>;
  return <main className="flex-1 overflow-y-auto p-5"><div className="max-w-4xl mx-auto">
    <div className="flex items-center gap-3 mb-5"><div className="h-10 w-10 rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 flex items-center justify-center"><Clock3 size={18} /></div><div><h1 className="text-lg font-semibold">{t("vh.title")}</h1><p className="text-xs text-neutral-500">{allowedDays ? t("vh.visibleRange", { days: allowedDays }) : t("vh.desc")}</p></div></div>
    {loading && !rows.length ? <p className="text-sm text-neutral-400">{t("common.loading")}</p> : !rows.length ? <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-8 text-center text-sm text-neutral-500">{t("vh.empty")}</div> : <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-900 bg-white dark:bg-neutral-900">{rows.map((row) => {
      const Icon = ACTION_ICON[row.action] ?? Pencil;
      return <article key={row.id} className="flex items-start gap-3 p-3"><Icon size={14} className={row.action === "deleted" ? "text-red-500 mt-1" : "text-indigo-500 mt-1"} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-sm"><MetaChip>{row.entityType.replaceAll("_", " ")}</MetaChip><span className="text-neutral-500">{row.action.replaceAll("_", " ")}</span>{row.summary && <span className="text-neutral-800 dark:text-neutral-100">— {row.summary}</span>}</div>{row.changes && <div className="mt-1 text-xs text-neutral-500 break-words flex flex-wrap gap-x-3">{Object.entries(row.changes).map(([field, value]) => <span key={field} className="inline-flex items-center gap-1">{field.replace(/^custom:/, "")}: {JSON.stringify(value.from)} <InlineArrow /> {JSON.stringify(value.to)}</span>)}</div>}<div className="mt-1 text-[11px] text-neutral-400">{row.actor?.name ?? "System"} · {new Date(row.createdAt).toLocaleString()}</div></div></article>;
    })}</div>}
    {!done && rows.length > 0 && <Button variant="secondary" className="mt-3" onClick={() => load(rows[rows.length - 1]?.createdAt)} disabled={loading}>{loading ? t("common.loading") : t("vh.loadOlder")}</Button>}
  </div></main>;
}
