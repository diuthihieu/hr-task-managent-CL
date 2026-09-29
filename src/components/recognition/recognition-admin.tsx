"use client";
// Recognition management (workspace admins and the people they delegate to):
// scoring rules, who sees points, managers, reward catalog, approvals.
import { useEffect, useRef, useState } from "react";
import { Check, Gift, ImagePlus, Loader2, Plus, RefreshCcw, Save, ShieldCheck, Trash2, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import type { RewardDto } from "@/lib/recognition/rewards";
import { REDEMPTION_TONE, type Redemption } from "./rewards";
import { Avatar, fmtNumber } from "./shared";
import { NumberInput, formatThousands } from "@/components/ui/number-input";
import type { MessageKey } from "@/lib/i18n/core";

interface Settings {
  enabled: boolean;
  membersSeePoints: boolean;
  pointsSince: string | null;
  canDelegate: boolean;
  rules: { action: string; points: number; enabled: boolean }[];
  members: { id: string; name: string; email: string; avatarColor: string; role: string; isManager: boolean; canViewOthersPoints: boolean | null }[];
}
type Draft = { name: string; description: string; pointsCost: number | null; price: number | null; currency: string; quantity: number | null };
const emptyDraft = (): Draft => ({ name: "", description: "", pointsCost: 100, price: null, currency: "VND", quantity: 1 });

/** A labelled form field: the title says what goes in, the hint gives an example. */
function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block text-xs", className)}>
      <span className="block font-medium text-neutral-700 dark:text-neutral-200 mb-1">{label}</span>
      {children}
      {hint && <span className="block mt-0.5 text-[10px] text-neutral-400">{hint}</span>}
    </label>
  );
}

export function RecognitionAdmin({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const [s, setS] = useState<Settings | null>(null);
  const [rewards, setRewards] = useState<RewardDto[]>([]);
  const [requests, setRequests] = useState<Redemption[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]);
  const [busy, setBusy] = useState(false);
  const loadAll = () => {
    api.get<Settings>(`/api/workspaces/${workspaceId}/recognition/settings`).then(setS).catch((e) => toast.error(e.message));
    api.get<RewardDto[]>(`/api/workspaces/${workspaceId}/rewards`).then(setRewards).catch(() => {});
    api.get<Redemption[]>(`/api/workspaces/${workspaceId}/redemptions`).then(setRequests).catch(() => {});
  };
  useEffect(loadAll, [workspaceId]);

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
  async function addRewards() {
    const filled = drafts.filter((d) => d.name.trim());
    if (!filled.length) return toast.error(t("reco.admin.needName"));
    if (filled.some((d) => !d.pointsCost || d.pointsCost < 1)) return toast.error(t("reco.admin.needCost"));
    const items = filled.map((d) => ({ name: d.name.trim(), description: d.description.trim() || null, pointsCost: d.pointsCost!, price: d.price, currency: d.currency || "VND", quantity: d.quantity ?? 0 }));
    try {
      await api.post(`/api/workspaces/${workspaceId}/rewards`, { items });
      toast.success(t("reco.admin.rewardsAdded", { n: items.length }));
      setDrafts([emptyDraft()]);
      loadAll();
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
              <li key={r.id} className="flex flex-wrap items-center gap-2" data-testid="reco-request">
                <span className="font-medium">{r.user.name}</span>
                <span className="text-neutral-400">→</span>
                <span>{r.reward.name}</span>
                <span className="text-xs text-neutral-500">
                  {t("reco.unit.points", { n: fmtNumber(r.points) })} · {formatDate(r.createdAt)} · {t("reco.rewards.left", { n: fmtNumber(r.reward.remaining) })}
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
        <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5">
          <Gift size={14} /> {t("reco.admin.catalog")}
        </h3>
        <div className="space-y-2">
          {rewards.map((r) => (
            <RewardRow key={r.id} r={r} onPatch={(p) => patchReward(r.id, p)} onDelete={async () => { if (confirm(t("common.confirmDelete", { name: r.name }))) { await api.delete(`/api/rewards/${r.id}`); loadAll(); } }} onUploaded={loadAll} />
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-3 space-y-2">
          <p className="text-xs font-medium">{t("reco.admin.addRewards")}</p>
          {drafts.map((d, i) => {
            const set = (patch: Partial<Draft>) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="relative rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/60 p-3" data-testid="reward-draft">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{t("reco.admin.rewardN", { n: i + 1 })}</span>
                {drafts.length > 1 && (
                  <button onClick={() => setDrafts(drafts.filter((_, j) => j !== i))} className="absolute right-2 top-2 text-neutral-400 hover:text-red-600" aria-label={t("common.delete")}>
                    <X size={14} />
                  </button>
                )}
                <div className="mt-1.5 grid gap-3 md:grid-cols-2">
                  <Field label={`${t("reco.admin.rewardName")} *`} hint={t("reco.admin.rewardNameHint")}>
                    <Input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("reco.admin.rewardNamePh")} data-testid="reward-draft-name" />
                  </Field>
                  <Field label={t("reco.admin.rewardDesc")} hint={t("reco.admin.rewardDescHint")}>
                    <Input value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("reco.admin.rewardDescPh")} />
                  </Field>
                </div>
                <div className="mt-3 grid gap-3 grid-cols-2 md:grid-cols-4">
                  <Field label={`${t("reco.admin.cost")} *`} hint={t("reco.admin.costHint")}>
                    <NumberInput value={d.pointsCost} min={1} onValueChange={(v) => set({ pointsCost: v })} placeholder="1,000" className="text-right" data-testid="reward-draft-cost" />
                  </Field>
                  <Field label={t("reco.admin.price")} hint={t("reco.admin.priceHint")}>
                    <NumberInput value={d.price} min={0} onValueChange={(v) => set({ price: v })} placeholder="50,000" className="text-right" data-testid="reward-draft-price" />
                  </Field>
                  <Field label={t("reco.admin.currency")} hint={t("reco.admin.currencyHint")}>
                    <Input value={d.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8) })} placeholder="VND" />
                  </Field>
                  <Field label={`${t("reco.admin.quantity")} *`} hint={t("reco.admin.quantityHint")}>
                    <NumberInput value={d.quantity} min={0} onValueChange={(v) => set({ quantity: v })} placeholder="10" className="text-right" data-testid="reward-draft-qty" />
                  </Field>
                </div>
              </div>
            );
          })}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDrafts([...drafts, emptyDraft()])}>
              <Plus size={12} /> {t("reco.admin.addRow")}
            </Button>
            <Button size="sm" onClick={addRewards} data-testid="reward-add">
              <Save size={12} /> {t("reco.admin.saveRewards")}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function RewardRow({ r, onPatch, onDelete, onUploaded }: { r: RewardDto; onPatch: (p: Record<string, unknown>) => void; onDelete: () => void; onUploaded: () => void }) {
  const { t } = useT();
  const file = useRef<HTMLInputElement>(null);
  async function upload(f: File) {
    const form = new FormData();
    form.append("file", f);
    const res = await fetch(`/api/rewards/${r.id}/image`, { method: "PUT", body: form });
    if (!res.ok) toast.error((await res.json().catch(() => ({}))).error ?? t("common.failed"));
    else onUploaded();
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm rounded-lg px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60" data-testid="reward-row">
      <button onClick={() => file.current?.click()} className="h-10 w-10 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0" title={t("reco.admin.image")}>
        {r.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- authorized image route
          <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus size={15} className="text-neutral-400" />
        )}
      </button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <div className="flex-1 min-w-[10rem]">
        <p className={cn("font-medium", !r.active && "line-through text-neutral-400")}>{r.name}</p>
        <p className={cn("text-[11px]", r.soldOut ? "text-red-600 font-medium" : "text-neutral-500")}>
          {r.soldOut ? t("reco.rewards.soldOut") : t("reco.admin.stock", { given: formatThousands(r.approvedCount), total: formatThousands(r.quantity) })}
        </p>
      </div>
      <Field label={t("reco.admin.cost")} className="w-28">
        <NumberInput value={r.pointsCost} min={1} onValueChange={() => {}} onBlur={(e) => { const n = Number(e.target.value.replace(/,/g, "")); if (n && n !== r.pointsCost) onPatch({ pointsCost: n }); }} className="h-7 text-right" />
      </Field>
      <Field label={`${t("reco.admin.price")} (${r.currency})`} className="w-32">
        <NumberInput value={r.price} min={0} onValueChange={() => {}} onBlur={(e) => { const v = e.target.value.replace(/,/g, ""); const n = v ? Number(v) : null; if (n !== r.price) onPatch({ price: n }); }} className="h-7 text-right" />
      </Field>
      <Field label={t("reco.admin.quantity")} className="w-24">
        <NumberInput value={r.quantity} min={r.approvedCount} onValueChange={() => {}} onBlur={(e) => { const n = Number(e.target.value.replace(/,/g, "")); if (n !== r.quantity) onPatch({ quantity: n }); }} className="h-7 text-right" data-testid="reward-row-qty" />
      </Field>
      <Field label={t("reco.admin.active")} className="w-14">
        <Switch checked={r.active} onCheckedChange={(v) => onPatch({ active: v })} />
      </Field>
      <button onClick={onDelete} className="text-neutral-400 hover:text-red-600" aria-label={t("common.delete")}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}
