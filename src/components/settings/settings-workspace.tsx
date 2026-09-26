"use client";
import { useState } from "react";
import {
  Settings as SettingsIcon,
  Building2,
  Users,
  ShieldCheck,
  Flag,
  Tags,
  LayoutList,
  Palette,
  ArrowDownUp,
  History,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingsGeneral } from "./settings-general";
import { SettingsMembers } from "./settings-members";
import { SettingsPermissions } from "./settings-permissions";
import { SettingsTaskConfig } from "./settings-task-config";
import { SettingsViews } from "./settings-views";
import { SettingsAppearance } from "./settings-appearance";
import { SettingsDataIO } from "./settings-data-io";
import { SettingsAuditLog } from "./settings-audit-log";
import { SettingsSecurity } from "./settings-security";

const SECTIONS = [
  { key: "general", label: "Workspace", icon: Building2, group: "Workspace" },
  { key: "members", label: "Members & Roles", icon: Users, group: "Workspace" },
  { key: "permissions", label: "Permissions", icon: ShieldCheck, group: "Workspace" },
  { key: "statuses", label: "Task Statuses", icon: Flag, group: "Task configuration" },
  { key: "categories", label: "Categories", icon: Tags, group: "Task configuration" },
  { key: "views", label: "View Management", icon: LayoutList, group: "Task configuration" },
  { key: "appearance", label: "Appearance / Theme", icon: Palette, group: "Personal" },
  { key: "data-io", label: "Import / Export", icon: ArrowDownUp, group: "Data" },
  { key: "audit", label: "Audit Log", icon: History, group: "Data" },
  { key: "security", label: "Data & Security", icon: Lock, group: "Data" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];
const GROUPS = ["Workspace", "Task configuration", "Personal", "Data"] as const;

export function SettingsWorkspace({
  workspaceId,
  workspaceSlug,
  currentUserId,
  currentUserRole,
  isSystemAdmin,
}: {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  currentUserRole: string;
  isSystemAdmin: boolean;
}) {
  const [section, setSection] = useState<SectionKey>("general");

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 h-12 px-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <SettingsIcon size={15} className="text-indigo-500" />
          <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Settings</h1>
        </div>
        <nav className="flex-1 overflow-y-auto thin-scroll py-2 px-2 space-y-3">
          {GROUPS.map((group) => (
            <div key={group}>
              <div className="px-2 mb-0.5 text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">{group}</div>
              {SECTIONS.filter((s) => s.group === group).map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left",
                    section === s.key
                      ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium"
                      : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  )}
                >
                  <s.icon size={14} className="shrink-0" />
                  <span className="truncate">{s.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {section === "general" && <SettingsGeneral workspaceId={workspaceId} workspaceSlug={workspaceSlug} currentUserRole={currentUserRole} />}
        {section === "members" && <SettingsMembers workspaceId={workspaceId} currentUserId={currentUserId} currentUserRole={currentUserRole} isSystemAdmin={isSystemAdmin} />}
        {section === "permissions" && <SettingsPermissions />}
        {(section === "statuses" || section === "categories") && <SettingsTaskConfig workspaceId={workspaceId} mode={section} canEdit={currentUserRole === "owner" || currentUserRole === "admin"} />}
        {section === "views" && <SettingsViews workspaceId={workspaceId} workspaceSlug={workspaceSlug} />}
        {section === "appearance" && <SettingsAppearance />}
        {section === "data-io" && <SettingsDataIO workspaceId={workspaceId} />}
        {section === "audit" && <SettingsAuditLog workspaceId={workspaceId} />}
        {section === "security" && <SettingsSecurity />}
      </div>
    </div>
  );
}
