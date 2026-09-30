"use client";
// Reward catalog for members: what points can buy, stock, and my requests.
import { useEffect, useState } from "react";
import { Eye, Gift, Loader2, PackageX } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import type { RewardDto } from "@/lib/recognition/rewards";
import { fmtNumber } from "./shared";
import type { MessageKey } from "@/lib/i18n/core";
import { Meta } from "@/components/ui/meta";

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

  const [preview, setPreview] = useState<RewardDto | null>(null);
  async function redeem(r: RewardDto, note?: string) {
    try {
      await api.post(`/api/rewards/${r.id}/redeem`, { note: note || undefined });
      toast.success(t("reco.rewards.requested"));
      setPreview(null);
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
              <button type="button" onClick={() => setPreview(r)} className="group aspect-[4/3] bg-gradient-to-br from-indigo-50 to-indigo-100/60 dark:from-indigo-950/40 dark:to-indigo-900/30 flex items-center justify-center relative overflow-hidden" data-testid="reward-open">
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authorized image route
                  <img src={r.imageUrl} alt={r.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                ) : (
                  <Gift size={36} className="text-indigo-400" />
                )}
                {r.soldOut && (
                  <span className="absolute inset-0 bg-black/40 flex items-center justify-center text-white font-semibold gap-1.5" data-testid="reward-soldout">
                    <PackageX size={16} /> {t("reco.rewards.soldOut")}
                  </span>
                )}
                <span className="absolute bottom-2 right-2 rounded-full bg-black/55 text-white text-[10px] px-2 py-0.5 inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Eye size={11} /> {t("reco.rewards.view")}
                </span>
              </button>
              <div className="p-3 flex-1 flex flex-col">
                <button type="button" onClick={() => setPreview(r)} className="text-left font-semibold text-sm hover:text-indigo-600">{r.name}</button>
                {r.description && <p className="text-xs text-neutral-500 line-clamp-2 mt-0.5">{r.description}</p>}
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="font-bold text-indigo-600 tabular-nums">{t("reco.unit.points", { n: fmtNumber(r.pointsCost) })}</span>
                  {r.price !== null && <span className="text-neutral-400">≈ {money(r.price, r.currency)}</span>}
                  <span className="ml-auto text-neutral-500">{t("reco.rewards.left", { n: fmtNumber(r.remaining) })}</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                  <div className={cn("h-full rounded-full", enough ? "bg-emerald-500" : "bg-indigo-400")} style={{ width: `${pct}%` }} />
                </div>
                <Button size="sm" className="mt-3" disabled={!enough || r.soldOut} onClick={() => setPreview(r)} data-testid="reward-redeem">
                  {r.soldOut ? t("reco.rewards.soldOut") : enough ? t("reco.rewards.redeem") : t("reco.rewards.missing", { n: fmtNumber(r.pointsCost - balance) })}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {preview && <RewardPreview r={preview} balance={balance} onClose={() => setPreview(null)} onRedeem={(note) => redeem(preview, note)} />}
      {!!mine.length && (
        <section className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4" data-testid="reco-my-requests">
          <h3 className="text-sm font-semibold mb-2">{t("reco.rewards.myRequests")}</h3>
          <ul className="space-y-1.5 text-sm">
            {mine.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.reward.name}</span>
                <Meta className="text-xs"><span className="font-medium text-indigo-600 tabular-nums">{t("reco.unit.points", { n: fmtNumber(m.points) })}</span><span>{formatDate(m.createdAt)}</span></Meta>
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

/** Large view of one reward: picture, details, stock, how close I am, and the request form. */
function RewardPreview({ r, balance, onClose, onRedeem }: { r: RewardDto; balance: number; onClose: () => void; onRedeem: (note?: string) => Promise<void> }) {
  const { t } = useT();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const enough = balance >= r.pointsCost;
  const pct = Math.min(100, Math.round((balance / r.pointsCost) * 100));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <div className="grid md:grid-cols-2" data-testid="reward-preview">
          <div className="relative aspect-square md:aspect-auto md:min-h-[22rem] bg-gradient-to-br from-indigo-50 to-indigo-100/60 dark:from-indigo-950/40 dark:to-indigo-900/30 flex items-center justify-center">
            {r.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- authorized image route
              <img src={r.imageUrl} alt={r.name} className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <Gift size={72} className="text-indigo-400" />
            )}
            {r.soldOut && <span className="absolute inset-0 bg-black/45 flex items-center justify-center text-white font-semibold gap-1.5"><PackageX size={18} /> {t("reco.rewards.soldOut")}</span>}
          </div>
          <div className="p-5 flex flex-col">
            <DialogTitle className="text-lg">{r.name}</DialogTitle>
            {r.description ? <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300 whitespace-pre-line">{r.description}</p> : <p className="mt-1.5 text-sm text-neutral-400">{t("reco.rewards.noDesc")}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/40 p-2.5">
                <dt className="text-neutral-500">{t("reco.admin.cost")}</dt>
                <dd className="text-base font-bold text-indigo-600 tabular-nums">{fmtNumber(r.pointsCost)}</dd>
              </div>
              <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-2.5">
                <dt className="text-neutral-500">{t("reco.rewards.remaining")}</dt>
                <dd className="text-base font-bold tabular-nums">{fmtNumber(r.remaining)}</dd>
              </div>
              {r.price !== null && (
                <div className="col-span-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-2.5">
                  <dt className="text-neutral-500">{t("reco.admin.price")}</dt>
                  <dd className="font-semibold tabular-nums">{money(r.price, r.currency)}</dd>
                </div>
              )}
            </dl>
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-neutral-500 mb-1">
                <span>{t("reco.rewards.yourBalance", { n: fmtNumber(balance) })}</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                <div className={cn("h-full rounded-full", enough ? "bg-emerald-500" : "bg-indigo-400")} style={{ width: `${pct}%` }} />
              </div>
            </div>
            {enough && !r.soldOut && (
              <label className="mt-4 block">
                <span className="block text-xs font-medium mb-1">{t("reco.rewards.note")}</span>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("reco.rewards.notePh")} data-testid="reward-note" />
              </label>
            )}
            <div className="mt-auto pt-4 flex gap-2 justify-end">
              <Button variant="ghost" onClick={onClose}>
                {t("common.close")}
              </Button>
              <Button
                disabled={!enough || r.soldOut || busy}
                onClick={async () => {
                  setBusy(true);
                  await onRedeem(note.trim() || undefined);
                  setBusy(false);
                }}
                data-testid="reward-confirm"
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                {r.soldOut ? t("reco.rewards.soldOut") : enough ? t("reco.rewards.redeem") : t("reco.rewards.missing", { n: fmtNumber(r.pointsCost - balance) })}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
