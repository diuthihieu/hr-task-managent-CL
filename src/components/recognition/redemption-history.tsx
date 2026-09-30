"use client";
import { useEffect, useMemo, useState } from "react";
import { Gift, Loader2, History } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";
import { REDEMPTION_TONE, type Redemption } from "./rewards";
import { fmtNumber } from "./shared";

/** Everyone's own reward history: every request, its status, points and the manager's note. */
export function RedemptionHistory({ workspaceId, highlightId, onChanged }: { workspaceId: string; highlightId?: string | null; onChanged: () => void }) {
  const { t } = useT();
  const [rows, setRows] = useState<Redemption[] | null>(null);
  const [filter, setFilter] = useState<"all" | Redemption["status"]>("all");
  const load = () => api.get<Redemption[]>(`/api/workspaces/${workspaceId}/redemptions?mine=1`).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per workspace
  }, [workspaceId]);
  useEffect(() => {
    if (rows && highlightId) document.getElementById(`redemption-${highlightId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [rows, highlightId]);

  const totals = useMemo(() => {
    const r = rows ?? [];
    const sum = (s: Redemption["status"]) => r.filter((x) => x.status === s).reduce((a, x) => a + x.points, 0);
    return { received: r.filter((x) => x.status === "approved").length, spent: sum("approved"), reserved: sum("pending") };
  }, [rows]);

  async function cancel(id: string) {
    try {
      await api.patch(`/api/redemptions/${id}`, { action: "cancel" });
      load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  if (!rows)
    return (
      <div className="py-10 flex justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const card = "rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900";
  return (
    <div className="space-y-4" data-testid="reco-history">
      <div className="grid grid-cols-3 gap-3">
        {[
          [t("reco.history.received"), fmtNumber(totals.received)],
          [t("reco.history.spent"), t("reco.unit.points", { n: fmtNumber(totals.spent) })],
          [t("reco.history.reserved"), t("reco.unit.points", { n: fmtNumber(totals.reserved) })],
        ].map(([label, value]) => (
          <div key={label} className={cn(card, "p-4")}>
            <div className="text-xs text-neutral-500">{label}</div>
            <div className="text-xl font-bold tabular-nums mt-0.5">{value}</div>
          </div>
        ))}
      </div>
      <section className={card}>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-2">
          <History size={15} className="text-indigo-600" />
          <h3 className="text-sm font-semibold mr-2">{t("reco.history.title")}</h3>
          {(["all", "pending", "approved", "rejected", "cancelled"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full px-2.5 py-0.5 text-xs border", filter === f ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300")} data-testid={`history-filter-${f}`}>
              {f === "all" ? t("reco.history.all") : t(`reco.redemption.${f}` as MessageKey)} <span className="opacity-70">{f === "all" ? rows.length : rows.filter((r) => r.status === f).length}</span>
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="px-4 pb-8 pt-4 text-center text-sm text-neutral-400 flex flex-col items-center gap-2">
            <Gift size={22} className="opacity-50" /> {t("reco.history.empty")}
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {shown.map((m) => (
              <li key={m.id} id={`redemption-${m.id}`} className={cn("px-4 py-3 flex flex-wrap items-start gap-3", m.id === highlightId && "bg-indigo-50/60 dark:bg-indigo-950/30")} data-testid="history-row">
                <span className="h-9 w-9 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center shrink-0">
                  <Gift size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{m.reward.name}</span>
                    <span className={cn("text-[11px] px-1.5 py-0.5 rounded-md", REDEMPTION_TONE[m.status])} data-testid="history-status">{t(`reco.redemption.${m.status}` as MessageKey)}</span>
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5 flex flex-wrap gap-x-3">
                    <span className="font-medium text-indigo-600 tabular-nums">{t("reco.unit.points", { n: fmtNumber(m.points) })}</span>
                    <span>{t("reco.history.requestedOn", { date: formatDate(m.createdAt, true) })}</span>
                    {m.decidedAt && <span>{t("reco.history.decidedOn", { date: formatDate(m.decidedAt, true) })}</span>}
                  </div>
                  {m.note && <p className="text-xs text-neutral-500 mt-1">{t("reco.history.yourNote")}: “{m.note}”</p>}
                  {m.decisionNote && <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-1">{t("reco.history.managerNote")}: “{m.decisionNote}”</p>}
                </div>
                {m.status === "pending" && (
                  <button onClick={() => cancel(m.id)} className="text-xs text-neutral-500 hover:text-red-600" data-testid="history-cancel">
                    {t("reco.history.cancel")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
