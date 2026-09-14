import { Database, KeyRound, ShieldAlert } from "lucide-react";
import { SettingsSection } from "./settings-shell";

export function SettingsSecurity() {
  return (
    <SettingsSection title="Data & Security" description="Where your data lives and how access is protected.">
      <div className="space-y-3 max-w-lg">
        <div className="flex items-start gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-3">
          <Database size={16} className="text-neutral-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">Storage</div>
            <p className="text-xs text-neutral-400 mt-0.5">Records, fields and views are stored in a managed PostgreSQL database. Nothing lives only in the browser.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-3">
          <KeyRound size={16} className="text-neutral-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">Authentication</div>
            <p className="text-xs text-neutral-400 mt-0.5">Sign-in is session-based; passwords are hashed and never stored in plain text. Every API request is scoped to your workspace memberships.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-3">
          <ShieldAlert size={16} className="text-neutral-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">Access control</div>
            <p className="text-xs text-neutral-400 mt-0.5">Every read and write checks workspace membership server-side. See Permissions for what each role can do, and Audit Log for a record of activity.</p>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
