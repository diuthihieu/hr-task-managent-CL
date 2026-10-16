"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";

type Member = { id: string; name: string; email: string; role: string; isActive?: boolean };

/** An owner hands the workspace to another member and picks their own role afterwards. */
export function TransferOwnershipDialog({ open, onOpenChange, workspaceId, members, currentUserId, initialRole = "admin" }: { open: boolean; onOpenChange: (o: boolean) => void; workspaceId: string; members: Member[]; currentUserId: string; initialRole?: string }) {
  const { t } = useT();
  const [to, setTo] = useState("");
  const [myRole, setMyRole] = useState(initialRole);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const candidates = members.filter((m) => m.id !== currentUserId && m.isActive !== false);
  const target = candidates.find((m) => m.id === to);

  async function submit() {
    if (!target || !sure) return;
    setBusy(true);
    try {
      await api.post(`/api/workspaces/${workspaceId}/transfer-ownership`, { toUserId: target.id, myNewRole: myRole });
      toast.success(t("own.transferred", { name: target.name }));
      // Your own role changed: reload so every screen uses it.
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="transfer-ownership-dialog">
        <DialogTitle>{t("own.transferTitle")}</DialogTitle>
        <p className="text-xs text-neutral-500 mb-3">{t("own.transferLead")}</p>
        <label className="block text-xs font-medium mb-1">{t("own.newOwner")}</label>
        <Select className="w-full" value={to} onValueChange={setTo} options={[{ value: "", label: t("own.pick") }, ...candidates.map((m) => ({ value: m.id, label: `${m.name} · ${m.email}` }))]} data-testid="transfer-to" />
        <label className="block text-xs font-medium mt-3 mb-1">{t("own.myRole")}</label>
        <Select className="w-full" value={myRole} onValueChange={setMyRole} options={["admin", "editor", "contributor", "viewer"].map((r) => ({ value: r, label: t(`role.${r}` as MessageKey), description: t(`role.${r}.d` as MessageKey) }))} data-testid="transfer-my-role" />
        <label className="mt-3 flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="transfer-sure" />
          <span>{t("own.sure", { name: target?.name ?? "…" })}</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button variant="destructive" disabled={!target || !sure || busy} onClick={submit} data-testid="transfer-submit">{t("own.transfer")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Hand over what a member owns (projects, objectives, key results) to someone else. */
export function HandoverDialog({ member, onClose, workspaceId, members }: { member: Member | null; onClose: () => void; workspaceId: string; members: Member[] }) {
  const { t } = useT();
  const [to, setTo] = useState("");
  const [counts, setCounts] = useState<{ projects: number; objectives: number; keyResults: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const memberId = member?.id;
  useEffect(() => {
    if (!memberId) return;
    let live = true;
    api.get<{ projects: number; objectives: number; keyResults: number }>(`/api/workspaces/${workspaceId}/members/${memberId}/handover`).then((c) => live && setCounts(c)).catch(() => {});
    return () => {
      live = false;
    };
  }, [memberId, workspaceId]);
  const candidates = members.filter((m) => m.id !== member?.id && m.isActive !== false);
  const nothing = counts && counts.projects + counts.objectives + counts.keyResults === 0;

  async function submit() {
    if (!member || !to) return;
    setBusy(true);
    try {
      const r = await api.post<{ projects: number; objectives: number; keyResults: number }>(`/api/workspaces/${workspaceId}/members/${member.id}/handover`, { toUserId: to });
      toast.success(t("own.handedOver", { p: r.projects, o: r.objectives, k: r.keyResults }));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      {member && (
        <DialogContent data-testid="handover-dialog">
          <DialogTitle>{t("own.handoverTitle", { name: member.name })}</DialogTitle>
          <p className="text-xs text-neutral-500 mb-3">{t("own.handoverLead")}</p>
          <p className="text-xs mb-3" data-testid="handover-counts">
            {counts ? t("own.counts", { p: counts.projects, o: counts.objectives, k: counts.keyResults }) : t("common.loading")}
          </p>
          <label className="block text-xs font-medium mb-1">{t("own.handoverTo")}</label>
          <Select className="w-full" value={to} onValueChange={setTo} options={[{ value: "", label: t("own.pick") }, ...candidates.map((m) => ({ value: m.id, label: `${m.name} · ${m.email}` }))]} data-testid="handover-to" />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button disabled={!to || busy || !!nothing} onClick={submit} data-testid="handover-submit">{t("own.handover")}</Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
