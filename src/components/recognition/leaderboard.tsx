"use client";
// Recognition boards: top contributors (tasks / hours / points / kudos) and
// the colleagues who supported you most, for a week, month, quarter, year or
// any date range, top N of your choice.
import { useEffect, useState } from "react";
import { Crown, HeartHandshake, Loader2, Medal, Send, Trophy } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Avatar, fmtNumber, type PersonLite } from "./shared";
import { NumberInput } from "@/components/ui/number-input";
import type { MessageKey } from "@/lib/i18n/core";

interface Row {
  rank: number;
  user: PersonLite;
  value: number;
  detail?: Record<string, number>;
}
interface Board {
  rows: Row[];
  me?: Row | null;
  total: number;
  from?: string;
  to?: string;
}
type Period = "week" | "month" | "quarter" | "year" | "custom";
type Metric = "tasks" | "hours" | "points" | "kudos";

export function PeriodFilter({ period, setPeriod, from, setFrom, to, setTo, top, setTop }: { period: Period; setPeriod: (p: Period) => void; from: string; setFrom: (s: string) => void; to: string; setTo: (s: string) => void; top: number; setTop: (n: number) => void }) {
  const { t } = useT();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="reco-period">
      <div className="inline-flex rounded-lg border border-neutral-200 dark:border-neutral-800 p-0.5 bg-white dark:bg-neutral-900">
        {(["week", "month", "quarter", "year", "custom"] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={cn("h-7 px-2.5 rounded-md font-medium", period === p ? "bg-indigo-600 text-white" : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800")} data-testid={`reco-period-${p}`}>
            {t(`reco.period.${p}` as MessageKey)}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <span className="inline-flex items-center gap-1">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2" data-testid="reco-from" />
          →
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2" data-testid="reco-to" />
        </span>
      )}
      <label className="inline-flex items-center gap-1.5 text-neutral-500">
        {t("reco.top")}
        <NumberInput value={top} min={1} max={100} onValueChange={(v) => v && setTop(Math.min(100, v))} className="h-8 w-16" data-testid="reco-top" />
      </label>
    </div>
  );
}

export function Leaderboards({ workspaceId, canSeePoints, onThank }: { workspaceId: string; canSeePoints: boolean; onThank: (p: PersonLite) => void }) {
  const { t } = useT();
  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [top, setTop] = useState(10);
  const [metric, setMetric] = useState<Metric>("tasks");
  const [board, setBoard] = useState<Board | null>(null);
  const [helpers, setHelpers] = useState<Board | null>(null);
  const q = `period=${period}&top=${top}${period === "custom" ? `&from=${from}&to=${to}` : ""}`;

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setBoard(null);
      api.get<Board>(`/api/workspaces/${workspaceId}/recognition/leaderboard?metric=${metric}&${q}`).then((b) => !cancelled && setBoard(b)).catch(() => !cancelled && setBoard({ rows: [], total: 0 }));
      api.get<Board>(`/api/workspaces/${workspaceId}/recognition/supporters?${q}`).then((b) => !cancelled && setHelpers(b)).catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workspaceId, metric, q]);

  const metrics: Metric[] = canSeePoints ? ["tasks", "hours", "points", "kudos"] : ["tasks", "hours", "kudos"];
  const unit = (m: Metric, v: number) => t(`reco.unit.${m}` as MessageKey, { n: fmtNumber(v) });
  const podium = board?.rows.slice(0, 3) ?? [];

  return (
    <div className="space-y-4" data-testid="reco-leaderboard">
      <PeriodFilter {...{ period, setPeriod, from, setFrom, to, setTo, top, setTop }} />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Trophy size={16} className="text-amber-500" />
            <h2 className="text-sm font-semibold">{t("reco.board.title")}</h2>
            <div className="ml-auto flex gap-1">
              {metrics.map((m) => (
                <button key={m} onClick={() => setMetric(m)} className={cn("h-7 px-2.5 rounded-full border text-xs", metric === m ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-300 dark:border-neutral-700")} data-testid={`reco-metric-${m}`}>
                  {t(`reco.metric.${m}` as MessageKey)}
                </button>
              ))}
            </div>
          </div>
          {!board ? (
            <div className="py-10 flex justify-center text-neutral-400">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : !board.rows.length ? (
            <p className="text-sm text-neutral-500 py-6 text-center">{t("reco.board.empty")}</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 items-end mb-4" data-testid="reco-podium">
                {[1, 0, 2].map((i) => {
                  const r = podium[i];
                  if (!r) return <div key={i} />;
                  const h = i === 0 ? "h-28" : i === 1 ? "h-20" : "h-16";
                  return (
                    <div key={r.user.id} className="flex flex-col items-center gap-1">
                      {i === 0 && <Crown size={18} className="text-amber-500" />}
                      <Avatar p={r.user} size={i === 0 ? 52 : 42} className="ring-2 ring-white dark:ring-neutral-900" />
                      <span className="text-xs font-semibold truncate max-w-full">{r.user.name}</span>
                      <span className="text-[11px] text-neutral-500">{unit(metric, r.value)}</span>
                      <div className={cn("w-full rounded-t-xl flex items-start justify-center pt-1.5 text-white font-bold", h, i === 0 ? "bg-gradient-to-t from-amber-500 to-yellow-400" : i === 1 ? "bg-gradient-to-t from-slate-400 to-slate-300" : "bg-gradient-to-t from-orange-700 to-orange-500")}>{r.rank}</div>
                    </div>
                  );
                })}
              </div>
              <ol className="space-y-1">
                {board.rows.map((r) => (
                  <li key={r.user.id} className={cn("flex items-center gap-3 rounded-xl px-2 py-1.5", board.me?.user.id === r.user.id ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60")} data-testid="reco-row">
                    <span className="w-6 text-center text-xs font-semibold text-neutral-500">{r.rank <= 3 ? <Medal size={14} className={cn("mx-auto", r.rank === 1 ? "text-amber-500" : r.rank === 2 ? "text-slate-400" : "text-orange-600")} /> : r.rank}</span>
                    <Avatar p={r.user} size={28} />
                    <span className="flex-1 truncate text-sm">{r.user.name}</span>
                    <span className="text-sm font-semibold tabular-nums">{unit(metric, r.value)}</span>
                  </li>
                ))}
              </ol>
              {board.me && !board.rows.some((r) => r.user.id === board.me!.user.id) && (
                <p className="mt-2 text-xs text-neutral-500 border-t border-neutral-100 dark:border-neutral-800 pt-2">{t("reco.board.you", { rank: board.me.rank, value: unit(metric, board.me.value), total: board.total })}</p>
              )}
            </>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4" data-testid="reco-supporters">
          <div className="flex items-center gap-2 mb-1">
            <HeartHandshake size={16} className="text-rose-500" />
            <h2 className="text-sm font-semibold">{t("reco.supporters.title")}</h2>
          </div>
          <p className="text-[11px] text-neutral-500 mb-2">{t("reco.supporters.hint")}</p>
          {!helpers ? null : !helpers.rows.length ? (
            <p className="text-xs text-neutral-500 py-4">{t("reco.supporters.empty")}</p>
          ) : (
            <ol className="space-y-2">
              {helpers.rows.map((r) => (
                <li key={r.user.id} className="flex items-start gap-2" data-testid="reco-supporter">
                  <Avatar p={r.user} size={30} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.user.name}</p>
                    <p className="text-[11px] text-neutral-500">
                      {Object.entries(r.detail ?? {})
                        .map(([k, n]) => t(`reco.supporters.${k}` as MessageKey, { n }))
                        .join(" ")}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onThank(r.user)} data-testid="reco-thank">
                    <Send size={11} /> {t("reco.thank")}
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
