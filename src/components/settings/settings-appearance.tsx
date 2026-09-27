"use client";
import { useT } from "@/components/i18n-provider";
import { PreferencesPanel } from "@/components/preferences/preferences-panel";
import { SettingsSection } from "./settings-shell";

export function SettingsAppearance() {
  const { t } = useT();
  return (
    <SettingsSection title={t("set.appearance")} description={t("set.appearanceDesc")}>
      <div className="max-w-2xl">
        <PreferencesPanel />
      </div>
    </SettingsSection>
  );
}
