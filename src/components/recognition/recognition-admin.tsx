"use client";
// Recognition management (workspace admins and the people they delegate to):
// scoring rules, who sees points, managers, reward catalog, approvals.
import { useEffect, useState } from "react";
import { Check, Gift, ImagePlus, Loader2, Pencil, Plus, RefreshCcw, Save, ShieldCheck, Trash2, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import type { RewardDto } from "@/lib/recognition/rewards";
import { REDEMPTION_TONE, money, type Redemption } from "./rewards";
import { RewardDialog } from "./reward-editor";
import { Avatar, fmtNumber } from "./shared";
import { NumberInput, formatThousands } from "@/components/ui/number-input";
import type { MessageKey } from "@/lib/i18n/core";
import { Meta } from "@/components/ui/meta";

interface Settings {
  enabled: boolean;
  membersSeePoints: boolean;
  pointsSince: string | null;
  canDelegate: boolean;
  rules: { action: string; points: number; enabled: boolean }[];
  members: { id: string; name: string; email: string; avatarColor: string; role: string; isManager: boolean; canViewOthersPoints: boolean | null }[];
}

export function RecognitionAdmin({ workspaceId, highlightId }: { workspaceId: string; highlightId?: string | null }) {
  const { t } = useT();
  const [s, setS] = useState<Settings | null>(null);
  const [rewards, setRewards] = useState<RewardDto[]>([]);
  const [requests, setRequests] = useState<Redemption[]>([]);
  const [editing, setEditing] = useState<RewardDto | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const loadAll = () => {
    api.get<Settings>(`/api/workspaces/${workspaceId}/recognition/settings`).then(setS).catch((e) => toast.error(e.message));
    api.get<RewardDto[]>(`/api/workspaces/${workspaceId}/rewards`).then(setRewards).catch(() => {});
    api.get<Redemption[]>(`/api/workspaces/${workspaceId}/redemptions`).then(setRequests).catch(() => {});
  };
  useEffect(loadAll, [workspaceId]);
  // Opened from a "wants to redeem" notification: bring that request into view.
  useEffect(() => {
    if (highlightId && requests.length) document.getElementById(`request-${highlightId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId, requests.length]);

  async function saveSettings() {
    if (!s) return;
    setBusy(true);
    try {
      await api.put(`/api/workspaces/${workspaceId}/recognition/settings`, { enabled: s.enabled, membersSeePoints: s.membersSeePoints, pointsSince: s.pointsSince, rules: s.rules });
      toast.success(t("reco.admin.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }
  async function recalc() {
    if (!confirm(t("reco.admin.recalcConfirm"))) return;
    setBusy(true);
    try {
      const r = await api.post<{ added: number }>(`/api/workspaces/${workspaceId}/recognition/recalculate`);
      toast.success(t("reco.admin.recalcDone", { n: r.added }));
    } finally {
      setBusy(false);
    }
  }
  async function setVisibility(userId: string, v: boolean | null) {
    await api.put(`/api/workspaces/${workspaceId}/recognition/members/${userId}`, { canViewOthersPoints: v });
    setS((x) => (x ? { ...x, members: x.members.map((m) => (m.id === userId ? { ...m, canViewOthersPoints: v } : m)) } : x));
  }
  async function toggleManager(userId: string) {
    if (!s) return;
    const ids = s.members.filter((m) => (m.id === userId ? !m.isManager : m.isManager)).map((m) => m.id);
    try {
      await api.put(`/api/workspaces/${workspaceId}/recognition/managers`, { userIds: ids });
      setS({ ...s, members: s.members.map((m) => ({ ...m, isManager: ids.includes(m.id) })) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  async function patchReward(id: string, patch: Record<string, unknown>) {
    try {
      await api.patch(`/api/rewards/${id}`, patch);
      loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  async function decide(id: string, action: "approve" | "reject") {
    const note = action === "reject" ? (prompt(t("reco.admin.rejectReason")) ?? undefined) : undefined;
    try {
      await api.patch(`/api/redemptions/${id}`, { action, note });
      toast.success(t(`reco.admin.${action}d` as MessageKey));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
    loadAll();
  }

  if (!s)
    return (
      <div className="py-10 flex justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  const card = "rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4";
  const pending = requests.filter((r) => r.status === "pending");
  return (
    <div className="space-y-4" data-testid="reco-admin">
      {/* Approvals first: they are what needs action. */}
      <section className={card} data-testid="reco-approvals">
        <h3 className="text-sm font-semibold mb-2">{t("reco.admin.requests", { n: pending.length })}</h3>
        {!requests.length ? (
          <p className="text-xs text-neutral-500">{t("reco.admin.noRequests")}</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {requests.map((r) => (
              <li key={r.id} id={`request-${r.id}`} className={cn("flex flex-wrap items-center gap-2 rounded-lg", r.id === highlightId && "ring-2 ring-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/30 p-2")} data-testid="reco-request">
                <span className="font-medium">{r.user.name}</span>
                <span className="text-neutral-400">→</span>
                <span>{r.reward.name}</span>
                <span className="text-xs text-neutral-500">
                  <Meta><span className="font-medium text-indigo-600 tabular-nums">{t("reco.unit.points", { n: fmtNumber(r.points) })}</span><span>{formatDate(r.createdAt)}</span><span>{t("reco.rewards.left", { n: fmtNumber(r.reward.remaining) })}</span></Meta>
                </span>
                {r.note && <span className="text-xs text-neutral-500">“{r.note}”</span>}
                <span className={cn("text-[11px] px-1.5 py-0.5 rounded-md", REDEMPTION_TONE[r.status])}>{t(`reco.redemption.${r.status}` as MessageKey)}</span>
                {r.status === "pending" && (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" onClick={() => decide(r.id, "approve")} disabled={r.reward.remaining <= 0} data-testid="reco-approve">
                      <Check size={12} /> {r.reward.remaining <= 0 ? t("reco.rewards.soldOut") : t("reco.admin.approve")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(r.id, "reject")} data-testid="reco-reject">
                      <X size={12} /> {t("reco.admin.reject")}
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} data-testid="reco-rules">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold">{t("reco.admin.rules")}</h3>
            <label className="ml-auto flex items-center gap-2 text-xs">
              {t("reco.admin.enabled")} <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} />
            </label>
          </div>
          <p className="text-[11px] text-neutral-500 mb-2">{t("reco.admin.rulesHint")}</p>
          <table className="w-full text-sm">
            <tbody>
              {s.rules.map((r, i) => (
                <tr key={r.action} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-1.5 pr-2">{t(`reco.action.${r.action}` as MessageKey)}</td>
                  <td className="py-1.5 w-24">
                    <NumberInput value={r.points} min={0} max={1000} onValueChange={(v) => setS({ ...s, rules: s.rules.map((x, j) => (j === i ? { ...x, points: v ?? 0 } : x)) })} className="h-7 text-right" aria-label={t(`reco.action.${r.action}` as MessageKey)} data-testid={`rule-${r.action}`} />
                  </td>
                  <td className="py-1.5 pl-2 w-12">
                    <Switch checked={r.enabled} onCheckedChange={(v) => setS({ ...s, rules: s.rules.map((x, j) => (j === i ? { ...x, enabled: v } : x)) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="mt-3 flex items-center gap-2 text-xs">
            {t("reco.admin.since")}
            <input type="date" value={s.pointsSince ?? ""} onChange={(e) => setS({ ...s, pointsSince: e.target.value || null })} className="h-7 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2" />
          </label>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={saveSettings} disabled={busy} data-testid="reco-save-rules">
              <Save size={12} /> {t("common.save")}
            </Button>
            <Button size="sm" variant="outline" onClick={recalc} disabled={busy}>
              <RefreshCcw size={12} /> {t("reco.admin.recalc")}
            </Button>
          </div>
        </section>

        <section className={card} data-testid="reco-visibility">
          <h3 className="text-sm font-semibold">{t("reco.admin.people")}</h3>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <Switch checked={s.membersSeePoints} onCheckedChange={(v) => setS({ ...s, membersSeePoints: v })} /> {t("reco.admin.defaultSee")}
          </label>
          <p className="text-[11px] text-neutral-500 mt-1 mb-2">{t("reco.admin.peopleHint")}</p>
          <ul className="space-y-1 max-h-80 overflow-y-auto thin-scroll">
            {s.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm" data-testid="reco-member">
                <Avatar p={m} size={24} />
                <span className="flex-1 truncate">{m.name}</span>
                <select
                  value={m.canViewOthersPoints === null ? "" : m.canViewOthersPoints ? "1" : "0"}
                  onChange={(e) => setVisibility(m.id, e.target.value === "" ? null : e.target.value === "1")}
                  className="h-7 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1 text-xs"
                  data-testid="reco-member-visibility"
                >
                  <option value="">{t("reco.admin.see.default")}</option>
                  <option value="1">{t("reco.admin.see.show")}</option>
                  <option value="0">{t("reco.admin.see.hide")}</option>
                </select>
                {s.canDelegate && m.role !== "owner" && m.role !== "admin" && (
                  <button onClick={() => toggleManager(m.id)} className={cn("h-7 px-2 rounded-md border text-[11px] inline-flex items-center gap-1", m.isManager ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-300 dark:border-neutral-700")} title={t("reco.admin.delegateHint")} data-testid="reco-delegate">
                    <ShieldCheck size={11} /> {t("reco.admin.manager")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className={card} data-testid="reco-catalog">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
            <Gift size={14} /> {t("reco.admin.catalog")} <span className="ml-1 rounded-full bg-neutral-100 dark:bg-neutral-800 px-1.5 text-[10px] text-neutral-500 font-normal tabular-nums">{rewards.length}</span>
          </h3>
          <Button size="sm" onClick={() => setEditing("new")} data-testid="reward-new">
            <Plus size={12} /> {t("reco.admin.newReward")}
          </Button>
        </div>
        {!rewards.length && (
          <button onClick={() => setEditing("new")} className="w-full rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 py-8 text-sm text-neutral-500 hover:border-indigo-400 hover:text-indigo-600 flex flex-col items-center gap-1.5">
            <Gift size={22} /> {t("reco.admin.catalogEmpty")}
          </button>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rewards.map((r) => (
            <RewardAdminCard
              key={r.id}
              r={r}
              onEdit={() => setEditing(r)}
              onToggle={(v) => patchReward(r.id, { active: v })}
              onDelete={async () => {
                if (!confirm(t("reco.admin.confirmDeleteReward", { name: r.name, n: r.pending }))) return;
                await api.delete(`/api/rewards/${r.id}`).catch((e) => toast.error(e.message));
                loadAll();
              }}
            />
          ))}
        </div>
      </section>
      {editing && <RewardDialog workspaceId={workspaceId} reward={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={loadAll} />}
    </div>
  );
}

function RewardAdminCard({ r, onEdit, onToggle, onDelete }: { r: RewardDto; onEdit: () => void; onToggle: (v: boolean) => void; onDelete: () => void }) {
  const { t } = useT();
  return (
    <div className={cn("rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden flex flex-col bg-white dark:bg-neutral-900", !r.active && "opacity-60")} data-testid="reward-row">
      <button onClick={onEdit} className="relative aspect-[16/10] bg-gradient-to-br from-indigo-50 to-indigo-100/60 dark:from-indigo-950/40 dark:to-indigo-900/30 flex items-center justify-center" title={t("common.edit")}>
        {r.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- authorized image route
          <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[11px] text-neutral-400">
            <ImagePlus size={20} /> {t("reco.admin.image")}
          </span>
        )}
        {!r.active && <span className="absolute left-2 top-2 rounded-md bg-neutral-900/70 text-white text-[10px] px-1.5 py-0.5">{t("reco.admin.hidden")}</span>}
        {r.pending > 0 && <span className="absolute right-2 top-2 rounded-md bg-amber-500 text-white text-[10px] px-1.5 py-0.5">{t("reco.admin.pendingN", { n: r.pending })}</span>}
      </button>
      <div className="p-3 flex-1 flex flex-col gap-1">
        <p className="font-semibold text-sm leading-tight line-clamp-1">{r.name}</p>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-indigo-600 tabular-nums">{t("reco.unit.points", { n: fmtNumber(r.pointsCost) })}</span>
          {r.price !== null && <span className="text-neutral-400">≈ {money(r.price, r.currency)}</span>}
        </div>
        <p className={cn("text-[11px]", r.soldOut ? "text-red-600 font-medium" : "text-neutral-500")}>
          {r.soldOut ? t("reco.rewards.soldOut") : t("reco.admin.stock", { given: formatThousands(r.approvedCount), total: formatThousands(r.quantity) })}
        </p>
        <div className="mt-auto pt-2 flex items-center gap-1.5">
          <Switch checked={r.active} onCheckedChange={onToggle} />
          <span className="text-[11px] text-neutral-500">{t("reco.admin.active")}</span>
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={onEdit} data-testid="reward-edit">
            <Pencil size={11} /> {t("common.edit")}
          </Button>
          <button onClick={onDelete} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" aria-label={t("common.delete")} data-testid="reward-delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
