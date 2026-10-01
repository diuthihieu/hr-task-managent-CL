"use client";

import { LayoutDashboard } from "lucide-react";
import { DashboardTabs } from "./dashboard-tabs";
import { useT } from "@/components/i18n-provider";

/** Empty-dashboard landing. As soon as a dashboard exists the server route
 * opens the first sheet; additional sheets are switched from the tab strip. */
export function DashboardsIndex({ workspaceId, workspaceSlug, canEdit }: { workspaceId: string; workspaceSlug: string; canEdit: boolean }) {
  const { t } = useT();
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 h-12 px-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <LayoutDashboard size={15} className="text-indigo-500" />
        <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{t("db.title")}</h1>
      </div>
      <DashboardTabs workspaceId={workspaceId} workspaceSlug={workspaceSlug} canEdit={canEdit} />
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center text-neutral-400">
        <LayoutDashboard size={34} className="opacity-40" />
        <p className="text-sm">{t("db.empty")}</p>
        {canEdit && <p className="text-xs">{t("db.tabs.createHint")}</p>}
      </div>
    </div>
  );
}
