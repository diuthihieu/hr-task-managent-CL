"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

interface DashboardTab {
  id: string;
  name: string;
  widgetCount: number;
}

export function DashboardTabs({
  workspaceId,
  workspaceSlug,
  activeDashboardId,
  activeName,
  canEdit,
}: {
  workspaceId: string;
  workspaceSlug: string;
  activeDashboardId?: string;
  activeName?: string;
  canEdit: boolean;
}) {
  const { t } = useT();
  const router = useRouter();
  const [tabs, setTabs] = useState<DashboardTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setTabs(await api.get<DashboardTab[]>(`/api/workspaces/${workspaceId}/dashboards`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the tab strip reflects dashboards authorized by the API
    load();
  }, [load]);

  async function createDashboard() {
    setCreating(true);
    try {
      const dashboard = await api.post<{ id: string; name: string }>(`/api/workspaces/${workspaceId}/dashboards`, { name: name.trim() || t("db.untitled") });
      setOpen(false);
      setName("");
      router.push(`/w/${workspaceSlug}/dash/${dashboard.id}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="flex h-10 shrink-0 items-end gap-0 overflow-x-auto border-b border-neutral-200 bg-neutral-50 px-3 dark:border-neutral-800 dark:bg-neutral-950 thin-scroll" role="tablist" aria-label={t("db.tabs.aria")}>
        {loading && <span className="self-center px-2 text-xs text-neutral-400">{t("common.loading")}</span>}
        {tabs.map((tab) => {
          const active = tab.id === activeDashboardId;
          const label = active && activeName ? activeName : tab.name;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              title={`${label} · ${tab.widgetCount} ${t("db.tabs.widgets")}`}
              onClick={() => !active && router.push(`/w/${workspaceSlug}/dash/${tab.id}`)}
              className={cn(
                "relative -mb-px flex h-9 max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-md border px-3 text-xs transition-colors",
                active
                  ? "z-10 border-neutral-200 border-b-white bg-white font-semibold text-indigo-700 dark:border-neutral-700 dark:border-b-neutral-900 dark:bg-neutral-900 dark:text-indigo-300"
                  : "border-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              )}
            >
              <LayoutDashboard size={12} className={active ? "text-indigo-500" : "text-neutral-400"} />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
        {canEdit && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mb-1 ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-200 hover:text-indigo-600 dark:hover:bg-neutral-800"
            title={t("db.new")}
            aria-label={t("db.new")}
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{t("db.new")}</DialogTitle>
          <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("common.name")}</label>
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={t("db.namePlaceholder")} onKeyDown={(event) => event.key === "Enter" && !creating && createDashboard()} />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={createDashboard} disabled={creating}>{t("db.create")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
