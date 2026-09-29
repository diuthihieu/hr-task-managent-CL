"use client";
// Reward catalog for members: what points can buy, stock, and my requests.
import { useEffect, useState } from "react";
import { Gift, Loader2, PackageX } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import type { RewardDto } from "@/lib/recognition/rewards";
import { fmtNumber } from "./shared";
import type { MessageKey } from "@/lib/i18n/core";

export interface Redemption {
  id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  points: number;
  note: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  reward: { id: string; name: string; remaining: number };
  user: { id: string; name: string };
}

export const REDEMPTION_TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  rejected: "bg-red-50 text-red-600 dark:bg-red-950/60",
  cancelled: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800",
};

/** 50000 VND -> "50,000 VND" (thousands with ",", any currency code). */
export const money = (v: number | null, cur: string) => (v === null ? "" : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v)} ${cur}`);

export function Rewards({ workspaceId, balance, onChanged }: { workspaceId: string; balance: number; onChanged: () => void }) {
  const { t } = useT();
  const [rewards, setRewards] = useState<RewardDto[] | null>(null);
  const [mine, setMine] = useState<Redemption[]>([]);
  const load = () => {
    api.get<RewardDto[]>(`/api/workspaces/${workspaceId}/rewards`).then(setRewards).catch(() => setRewards([]));
    api.get<Redemption[]>(`/api/workspaces/${workspaceId}/redemptions?mine=1`).then(setMine).catch(() => {});
  };
  useEffect(load, [workspaceId]);

  async function redeem(r: RewardDto) {
    const note = prompt(t("reco.rewards.notePrompt", { name: r.name })) ?? undefined;
    if (note === undefined) return;
    try {
      await api.post(`/api/rewards/${r.id}/redeem`, { note: note || undefined });
      toast.success(t("reco.rewards.requested"));
      load();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  async function cancel(id: string) {
    await api.patch(`/api/redemptions/${id}`, { action: "cancel" }).catch((e) => toast.error(e.message));
    load();
    onChanged();
  }

  if (!rewards)
    return (
      <div className="py-10 flex justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  return (
    <div className="space-y-5" data-testid="reco-rewards">
      {!rewards.length && <p className="text-sm text-neutral-500 py-6 text-center">{t("reco.rewards.empty")}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rewards.map((r) => {
          const enough = balance >= r.pointsCost;
          const pct = Math.min(100, Math.round((balance / r.pointsCost) * 100));
          return (
            <div key={r.id} className={cn("rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden flex flex-col", r.soldOut && "opacity-70")} data-testid="reward-card">
              <div className="aspect-[4/3] bg-gradient-to-br from-indigo-50 to-rose-50 dark:from-indigo-950/40 dark:to-rose-950/30 flex items-center justify-center relative">
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authorized image route
                  <img src={r.imageUrl} alt={r.name} className="h-full w-full object-cover" />
                ) : (
                  <Gift size={36} className="text-indigo-400" />
                )}
                {r.soldOut && (
                  <span className="absolute inset-0 bg-black/40 flex items-center justify-center text-white font-semibold gap-1.5" data-testid="reward-soldout">
                    <PackageX size={16} /> {t("reco.rewards.soldOut")}
                  </span>
                )}
              </div>
              <div className="p-3 flex-1 flex flex-col">
                <p className="font-semibold text-sm">{r.name}</p>
                {r.description && <p className="text-xs text-neutral-500 line-clamp-2 mt-0.5">{r.description}</p>}
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="font-bold text-indigo-600 tabular-nums">{t("reco.unit.points", { n: fmtNumber(r.pointsCost) })}</span>
                  {r.price !== null && <span className="text-neutral-400">≈ {money(r.price, r.currency)}</span>}
                  <span className="ml-auto text-neutral-500">{t("reco.rewards.left", { n: fmtNumber(r.remaining) })}</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                  <div className={cn("h-full rounded-full", enough ? "bg-emerald-500" : "bg-indigo-400")} style={{ width: `${pct}%` }} />
                </div>
                <Button size="sm" className="mt-3" disabled={!enough || r.soldOut} onClick={() => redeem(r)} data-testid="reward-redeem">
                  {r.soldOut ? t("reco.rewards.soldOut") : enough ? t("reco.rewards.redeem") : t("reco.rewards.missing", { n: fmtNumber(r.pointsCost - balance) })}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {!!mine.length && (
        <section className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4" data-testid="reco-my-requests">
          <h3 className="text-sm font-semibold mb-2">{t("reco.rewards.myRequests")}</h3>
          <ul className="space-y-1.5 text-sm">
            {mine.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.reward.name}</span>
                <span className="text-xs text-neutral-500">{t("reco.unit.points", { n: fmtNumber(m.points) })} · {formatDate(m.createdAt)}</span>
                <span className={cn("text-[11px] px-1.5 py-0.5 rounded-md", REDEMPTION_TONE[m.status])} data-testid="my-request-status">{t(`reco.redemption.${m.status}` as MessageKey)}</span>
                {m.decisionNote && <span className="text-xs text-neutral-500">“{m.decisionNote}”</span>}
                {m.status === "pending" && (
                  <button onClick={() => cancel(m.id)} className="ml-auto text-xs text-neutral-500 hover:text-red-600">
                    {t("common.cancel")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
