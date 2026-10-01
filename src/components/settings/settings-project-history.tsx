"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { SettingsSection } from "./settings-shell";

interface HistoryPolicy { memberDays: number; canManage: boolean }

export function SettingsProjectHistory({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const [policy, setPolicy] = useState<HistoryPolicy | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<HistoryPolicy>(`/api/workspaces/${workspaceId}/project-history-settings`).then(setPolicy).catch((error) => toast.error(error instanceof Error ? error.message : t("common.failed")));
  }, [t, workspaceId]);

  async function save() {
    if (!policy?.canManage) return;
    setSaving(true);
    try {
      const next = await api.patch<HistoryPolicy>(`/api/workspaces/${workspaceId}/project-history-settings`, { memberDays: policy.memberDays });
      setPolicy(next);
      toast.success(t("vh.settingsSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  return <SettingsSection title={t("vh.settingsTitle")} description={t("vh.settingsDesc")}>
    {!policy ? <p className="text-sm text-neutral-400">{t("common.loading")}</p> : <div className="max-w-xl rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-4">
      <label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-medium">{t("vh.memberAccess")}</span><span className="block text-xs text-neutral-500 mt-0.5">{t("vh.memberAccessDesc")}</span></span><input type="checkbox" className="h-4 w-4 accent-indigo-600" disabled={!policy.canManage} checked={policy.memberDays > 0} onChange={(event) => setPolicy({ ...policy, memberDays: event.target.checked ? 30 : 0 })} /></label>
      {policy.memberDays > 0 && <label className="block"><span className="block text-sm font-medium mb-1">{t("vh.days")}</span><input type="number" min={1} max={365} disabled={!policy.canManage} value={policy.memberDays} onChange={(event) => setPolicy({ ...policy, memberDays: Math.min(365, Math.max(1, Number(event.target.value) || 1)) })} className="h-9 w-40 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 text-sm" /><span className="ml-2 text-xs text-neutral-500">{t("vh.daysHint")}</span></label>}
      {!policy.canManage && <p className="text-xs text-amber-700 dark:text-amber-300">{t("vh.ownerOnly")}</p>}
      {policy.canManage && <div className="flex justify-end"><Button onClick={save} disabled={saving}>{saving ? t("common.saving") : t("common.save")}</Button></div>}
    </div>}
  </SettingsSection>;
}
