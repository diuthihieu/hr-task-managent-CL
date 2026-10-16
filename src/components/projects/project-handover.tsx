"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";

type Member = { id: string; name: string; email: string; role: string; isActive?: boolean };

/**
 * Hand the project over to another member: pick them, then confirm on a second
 * step that spells out what changes. Only editors and above can own a project.
 */
export function HandOverProjectDialog({ open, onOpenChange, projectId, projectName, currentOwnerId, workspaceId }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; projectName: string; currentOwnerId: string | null; workspaceId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [to, setTo] = useState("");
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get<Member[]>(`/api/workspaces/${workspaceId}/members?withRoles=1`).then(setMembers).catch(() => {});
  }, [open, workspaceId]);

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setTo("");
      setStep("pick");
    }
  };
  const candidates = members.filter((m) => m.id !== currentOwnerId && m.isActive !== false && ["owner", "admin", "editor"].includes(m.role));
  const target = candidates.find((m) => m.id === to);

  async function submit() {
    if (!target) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${projectId}/owner`, { toUserId: target.id });
      toast.success(t("po.done", { name: target.name }));
      close(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-testid="handover-project-dialog">
        <DialogTitle>{t("po.title")}</DialogTitle>
        {step === "pick" ? (
          <>
            <p className="text-xs text-neutral-500 mb-3">{t("po.lead")}</p>
            <label className="block text-xs font-medium mb-1">{t("po.newOwner")}</label>
            <Select
              className="w-full"
              value={to}
              onValueChange={setTo}
              options={[{ value: "", label: t("own.pick") }, ...candidates.map((m) => ({ value: m.id, label: `${m.name} · ${t(`role.${m.role}` as MessageKey)}` }))]}
              data-testid="po-to"
            />
            <p className="text-[11px] text-neutral-400 mt-1">{t("po.onlyEditors")}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => close(false)}>{t("common.cancel")}</Button>
              <Button disabled={!target} onClick={() => setStep("confirm")} data-testid="po-next">{t("po.handOver")}</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle size={16} className="shrink-0" />
              <div>
                <p className="font-semibold">{t("po.confirmTitle", { project: projectName, name: target?.name ?? "" })}</p>
                <ul className="list-disc pl-4 mt-1 space-y-0.5">
                  <li>{t("po.c1", { name: target?.name ?? "" })}</li>
                  <li>{t("po.c2")}</li>
                  <li>{t("po.c3")}</li>
                </ul>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep("pick")}>{t("po.back")}</Button>
              <Button variant="destructive" disabled={busy} onClick={submit} data-testid="po-confirm">{t("po.confirm")}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
