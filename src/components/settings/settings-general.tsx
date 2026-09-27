"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";
import { SettingsSection } from "./settings-shell";

interface WorkspaceDetail {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  role: string;
}

export function SettingsGeneral({ workspaceId, workspaceSlug, currentUserRole }: { workspaceId: string; workspaceSlug: string; currentUserRole: string }) {
  const { t, locale } = useT();
  const router = useRouter();
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const canEdit = ["owner", "admin"].includes(currentUserRole);

  useEffect(() => {
    api.get<WorkspaceDetail>(`/api/workspaces/${workspaceId}`).then((d) => {
      setDetail(d);
      setName(d.name);
    });
  }, [workspaceId]);

  async function save() {
    if (!name.trim() || name === detail?.name) return;
    setSaving(true);
    try {
      await api.patch(`/api/workspaces/${workspaceId}`, { name: name.trim() });
      setDetail((d) => (d ? { ...d, name: name.trim() } : d));
      toast.success(t("set.renamed"));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteWorkspace() {
    if (!detail) return;
    const typed = prompt(t("set.deleteWsConfirm"));
    if (typed?.trim() !== detail.name) return;
    try {
      await api.delete(`/api/workspaces/${workspaceId}`);
      router.push("/workspaces");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  if (!detail) return <div className="p-6 text-sm text-neutral-400">{t("common.loading")}</div>;

  return (
    <SettingsSection title={t("set.general")} description={t("set.generalDesc")}>
      <div className="space-y-4 max-w-md">
        <div>
          <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("set.wsName")}</label>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} onKeyDown={(e) => e.key === "Enter" && save()} />
            {canEdit && (
              <Button onClick={save} disabled={saving || !name.trim() || name === detail.name}>
                {t("common.save")}
              </Button>
            )}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("set.wsUrl")}</label>
          <Input value={`/w/${workspaceSlug}`} disabled />
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("set.created")}</label>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">{new Date(detail.createdAt).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-GB", { year: "numeric", month: "long", day: "numeric" })}</p>
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("set.yourRole")}</label>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">{t(`role.${detail.role}` as MessageKey)}</p>
        </div>
        {!canEdit && <p className="text-xs text-neutral-400">{t("set.renameOnly")}</p>}
        {currentUserRole === "owner" && (
          <div className="rounded-lg border border-red-200 dark:border-red-900 p-4 mt-6">
            <h3 className="text-sm font-semibold text-red-600">{t("ps.danger")}</h3>
            <p className="text-xs text-neutral-500 mt-1 mb-3">{t("set.deleteWsHint")}</p>
            <Button variant="destructive" onClick={deleteWorkspace}>
              <Trash2 size={13} /> {t("set.deleteWs")}
            </Button>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
