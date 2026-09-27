import { Database, KeyRound, ShieldAlert } from "lucide-react";
import { SettingsSection } from "./settings-shell";
import { useT } from "@/components/i18n-provider";

export function SettingsSecurity() {
  const { t } = useT();
  return (
    <SettingsSection title={t("set.security")} description={t("sec.desc")}>
      <div className="space-y-3 max-w-lg">
        <div className="flex items-start gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-3">
          <Database size={16} className="text-neutral-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{t("sec.storage")}</div>
            <p className="text-xs text-neutral-400 mt-0.5">{t("sec.storageDesc")}</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-3">
          <KeyRound size={16} className="text-neutral-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{t("sec.auth")}</div>
            <p className="text-xs text-neutral-400 mt-0.5">{t("sec.authDesc")}</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-3">
          <ShieldAlert size={16} className="text-neutral-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{t("sec.access")}</div>
            <p className="text-xs text-neutral-400 mt-0.5">{t("sec.accessDesc")}</p>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
