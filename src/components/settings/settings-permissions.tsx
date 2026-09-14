import { Check, Minus } from "lucide-react";
import { SettingsSection } from "./settings-shell";

const CAPABILITIES = [
  { label: "View records & dashboards", owner: true, admin: true, editor: true, contributor: true, viewer: true },
  { label: "Create / edit / delete records", owner: true, admin: true, editor: true, contributor: true, viewer: false },
  { label: "Create & edit views", owner: true, admin: true, editor: true, contributor: false, viewer: false },
  { label: "Add / edit fields", owner: true, admin: true, editor: true, contributor: false, viewer: false },
  { label: "Create bases, tables & dashboards", owner: true, admin: true, editor: true, contributor: false, viewer: false },
  { label: "Manage members & roles", owner: true, admin: true, editor: false, contributor: false, viewer: false },
  { label: "Rename / archive workspace & bases", owner: true, admin: true, editor: false, contributor: false, viewer: false },
];

const ROLES = ["owner", "admin", "editor", "contributor", "viewer"] as const;

export function SettingsPermissions() {
  return (
    <SettingsSection title="Permissions" description="What each role can do in this workspace. Assign roles from Members & Roles.">
      <div className="overflow-x-auto thin-scroll border border-neutral-200 dark:border-neutral-800 rounded-lg max-w-3xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
              <th className="text-left font-medium text-neutral-500 px-3 py-2">Capability</th>
              {ROLES.map((r) => (
                <th key={r} className="text-center font-medium text-neutral-500 px-3 py-2 capitalize">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((cap) => (
              <tr key={cap.label} className="border-b border-neutral-100 dark:border-neutral-900 last:border-0">
                <td className="px-3 py-2 text-neutral-700 dark:text-neutral-300">{cap.label}</td>
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
      <p className="text-xs text-neutral-400 mt-3 max-w-2xl">
        Enforcement today happens at the workspace level (membership required to read or write anything). Per-capability
        enforcement for contributor/viewer is the next increment - roles are already assignable and visible everywhere so
        that layer can land without another data migration.
      </p>
    </SettingsSection>
  );
}
