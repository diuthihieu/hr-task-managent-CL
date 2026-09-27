"use client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/components/i18n-provider";
import { PreferencesPanel } from "./preferences-panel";

export function PreferencesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogTitle>{t("nav.preferences")}</DialogTitle>
        <PreferencesPanel />
      </DialogContent>
    </Dialog>
  );
}
