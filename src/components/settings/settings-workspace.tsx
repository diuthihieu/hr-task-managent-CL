"use client";
import { useState } from "react";
import { Settings as SettingsIcon, Building2, Users, ShieldCheck, Flag, LayoutList, Palette, ArrowDownUp, History, Lock, UserCircle, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";
import { SettingsGeneral } from "./settings-general";
import { SettingsMembers } from "./settings-members";
import { SettingsPermissions } from "./settings-permissions";
import { SettingsTaskConfig } from "./settings-task-config";
import { SettingsViews } from "./settings-views";
import { SettingsAppearance } from "./settings-appearance";
import { SettingsDataIO } from "./settings-data-io";
import { SettingsAuditLog } from "./settings-audit-log";
import { SettingsSecurity } from "./settings-security";
import { SettingsProfile } from "./settings-profile";
import { SettingsNotifications } from "./settings-notifications";

// Categories are configured per project (Project → Settings), not here.
const SECTIONS: { key: string; label: MessageKey; icon: React.ComponentType<{ size?: number; className?: string }>; group: MessageKey }[] = [
  { key: "general", label: "set.general", icon: Building2, group: "set.group.workspace" },
  { key: "members", label: "set.members", icon: Users, group: "set.group.workspace" },
  { key: "permissions", label: "set.permissions", icon: ShieldCheck, group: "set.group.workspace" },
  { key: "statuses", label: "set.statuses", icon: Flag, group: "set.group.tasks" },
  { key: "views", label: "set.views", icon: LayoutList, group: "set.group.tasks" },
  { key: "profile", label: "set.profile", icon: UserCircle, group: "set.group.personal" },
  { key: "appearance", label: "set.appearance", icon: Palette, group: "set.group.personal" },
  { key: "notifications", label: "set.notifications", icon: BellRing, group: "set.group.personal" },
  { key: "data-io", label: "set.dataIo", icon: ArrowDownUp, group: "set.group.data" },
  { key: "audit", label: "set.audit", icon: History, group: "set.group.data" },
  { key: "security", label: "set.security", icon: Lock, group: "set.group.data" },
];
const GROUPS: MessageKey[] = ["set.group.workspace", "set.group.tasks", "set.group.personal", "set.group.data"];

export function SettingsWorkspace({
  workspaceId,
  workspaceSlug,
  currentUserId,
  currentUserRole,
  isSystemAdmin,
  initialSection = "general",
}: {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  currentUserRole: string;
  isSystemAdmin: boolean;
  initialSection?: string;
}) {
  const { t } = useT();
  const [section, setSection] = useState<string>(SECTIONS.some((s) => s.key === initialSection) ? initialSection : "general");

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="hidden md:flex w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 flex-col overflow-hidden">
        <div className="flex items-center gap-2 h-12 px-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <SettingsIcon size={15} className="text-indigo-500" />
          <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{t("set.title")}</h1>
        </div>
        <nav className="flex-1 overflow-y-auto thin-scroll py-2 px-2 space-y-3">
          {GROUPS.map((group) => (
            <div key={group}>
              <div className="px-2 mb-0.5 text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">{t(group)}</div>
              {SECTIONS.filter((s) => s.group === group).map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left",
                    section === s.key ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  )}
                  data-testid={`settings-${s.key}`}
                >
                  <s.icon size={14} className="shrink-0" />
                  <span className="truncate">{t(s.label)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        <div className="md:hidden sticky top-0 z-10 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-3 py-2">
          <select value={section} onChange={(e) => setSection(e.target.value)} className="w-full h-9 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm" aria-label={t("set.title")} data-testid="settings-mobile-nav">
            {GROUPS.map((g) => (
              <optgroup key={g} label={t(g)}>
                {SECTIONS.filter((s) => s.group === g).map((s) => (
                  <option key={s.key} value={s.key}>
                    {t(s.label)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {section === "general" && <SettingsGeneral workspaceId={workspaceId} workspaceSlug={workspaceSlug} currentUserRole={currentUserRole} />}
        {section === "members" && <SettingsMembers workspaceId={workspaceId} currentUserId={currentUserId} currentUserRole={currentUserRole} isSystemAdmin={isSystemAdmin} />}
        {section === "permissions" && <SettingsPermissions />}
        {section === "statuses" && <SettingsTaskConfig workspaceId={workspaceId} mode="statuses" canEdit={currentUserRole === "owner" || currentUserRole === "admin"} />}
        {section === "views" && <SettingsViews workspaceId={workspaceId} workspaceSlug={workspaceSlug} />}
        {section === "profile" && <SettingsProfile />}
        {section === "appearance" && <SettingsAppearance />}
        {section === "notifications" && <SettingsNotifications />}
        {section === "data-io" && <SettingsDataIO workspaceId={workspaceId} />}
        {section === "audit" && <SettingsAuditLog workspaceId={workspaceId} />}
        {section === "security" && <SettingsSecurity />}
      </div>
    </div>
  );
}
