"use client";
import { Check, Minus } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";
import { SettingsSection } from "./settings-shell";

// Mirrors the checks in src/lib/authz.ts and the route handlers - these are
// enforced by the API, not just hidden in the UI.
const CAPABILITIES: { label: MessageKey; owner: boolean; admin: boolean; editor: boolean; contributor: boolean; viewer: boolean }[] = [
  { label: "perm.view", owner: true, admin: true, editor: true, contributor: true, viewer: true },
  { label: "perm.comment", owner: true, admin: true, editor: true, contributor: true, viewer: true },
  { label: "perm.ownTasks", owner: true, admin: true, editor: true, contributor: true, viewer: false },
  { label: "perm.wiki", owner: true, admin: true, editor: true, contributor: true, viewer: false },
  { label: "perm.anyTask", owner: true, admin: true, editor: true, contributor: false, viewer: false },
  { label: "perm.projects", owner: true, admin: true, editor: true, contributor: false, viewer: false },
  { label: "perm.config", owner: true, admin: true, editor: true, contributor: false, viewer: false },
  { label: "perm.allProjects", owner: true, admin: true, editor: false, contributor: false, viewer: false },
  { label: "perm.members", owner: true, admin: true, editor: false, contributor: false, viewer: false },
  { label: "perm.deleteWs", owner: true, admin: false, editor: false, contributor: false, viewer: false },
];

const ROLES = ["owner", "admin", "editor", "contributor", "viewer"] as const;

export function SettingsPermissions() {
  const { t } = useT();
  return (
    <SettingsSection title={t("set.permissions")} description={t("perm.desc")}>
      <div className="overflow-x-auto thin-scroll border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-4xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
              <th className="text-left font-medium text-neutral-500 px-3 py-2">{t("perm.capability")}</th>
              {ROLES.map((r) => (
                <th key={r} className="text-center font-medium text-neutral-500 px-3 py-2">{t(`role.${r}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((cap) => (
              <tr key={cap.label} className="border-b border-neutral-100 dark:border-neutral-900 last:border-0">
                <td className="px-3 py-2 text-neutral-700 dark:text-neutral-300">{t(cap.label)}</td>
                {ROLES.map((r) => (
                  <td key={r} className="text-center px-3 py-2">
                    {cap[r] ? <Check size={14} className="inline text-green-600 dark:text-green-500" /> : <Minus size={14} className="inline text-neutral-300 dark:text-neutral-700" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-400 mt-3 max-w-2xl">{t("perm.note")}</p>
    </SettingsSection>
  );
}
