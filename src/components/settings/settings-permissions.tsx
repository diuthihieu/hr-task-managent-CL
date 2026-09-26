import { Check, Minus } from "lucide-react";
import { SettingsSection } from "./settings-shell";

// Mirrors the checks in src/lib/authz.ts and the route handlers - these are
// enforced by the API, not just hidden in the UI.
const CAPABILITIES = [
  { label: "View projects, tasks, OKRs & dashboards", owner: true, admin: true, editor: true, contributor: true, viewer: true },
  { label: "Comment on tasks", owner: true, admin: true, editor: true, contributor: true, viewer: true },
  { label: "Create tasks; edit/delete tasks they created or are assigned to", owner: true, admin: true, editor: true, contributor: true, viewer: false },
  { label: "Edit / delete any task, restore deleted tasks", owner: true, admin: true, editor: true, contributor: false, viewer: false },
  { label: "Custom fields, views, dashboards, objectives & key results", owner: true, admin: true, editor: true, contributor: false, viewer: false },
  { label: "Projects, statuses, categories, audit log", owner: true, admin: true, editor: false, contributor: false, viewer: false },
  { label: "Add members & change roles (admins can't grant owner)", owner: true, admin: true, editor: false, contributor: false, viewer: false },
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
        Accounts themselves are created only by a system administrator (Admin console). System admins act as owners in
        every workspace. Deactivated accounts lose access immediately.
      </p>
    </SettingsSection>
  );
}
