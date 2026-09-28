"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { BadgeCheck, Loader2, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn, formatDate } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";

interface Person {
  id: string;
  name: string;
  avatarColor: string;
}
interface Approval {
  id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  note: string | null;
  decisionNote: string | null;
  completeOnApprove: boolean;
  createdAt: string;
  decidedAt: string | null;
  requestedBy: Person | null;
  approver: Person;
}

const STATUS_STYLE: Record<Approval["status"], string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  cancelled: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800",
};

/**
 * "Request approval" on a task + the list of its approval requests. The
 * approver decides here or from their Action Center; the requester can cancel.
 */
export function TaskApprovals({ taskId, canEdit, onChanged }: { taskId: string; canEdit: boolean; onChanged?: () => void }) {
  const { t } = useT();
  const me = (useSession().data?.user as { id?: string } | undefined)?.id;
  const [items, setItems] = useState<Approval[]>([]);
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [approverId, setApproverId] = useState("");
  const [note, setNote] = useState("");
  const [complete, setComplete] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<Approval[]>(`/api/tasks/${taskId}/approvals`).then(setItems).catch(() => {});
  }, [taskId]);
  useEffect(() => {
    load();
  }, [load]);

  async function openDialog() {
    setOpen(true);
    const list = await api.get<Person[]>(`/api/tasks/${taskId}/mentionable`).catch(() => []);
    const others = list.filter((p) => p.id !== me);
    setPeople(others);
    setApproverId((cur) => cur || others[0]?.id || "");
  }

  async function request() {
    if (!approverId) return;
    setBusy(true);
    try {
      await api.post(`/api/tasks/${taskId}/approvals`, { approverId, note: note.trim() || undefined, completeOnApprove: complete });
      toast.success(t("apr.sent"));
      setOpen(false);
      setNote("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function decide(a: Approval, decision: "approve" | "reject" | "cancel") {
    const reason = decision === "reject" ? window.prompt(t("ac.rejectReason")) : "";
    if (reason === null) return;
    try {
      await api.patch(`/api/approvals/${a.id}`, { decision, note: reason || undefined });
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <>
      {canEdit && (
        <Button variant="outline" onClick={openDialog} data-testid="request-approval">
          <BadgeCheck size={14} /> {t("apr.request")}
        </Button>
      )}
      {items.length > 0 && (
        <div className="basis-full mt-1 space-y-1.5" data-testid="approvals">
          {items.slice(0, 5).map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs" data-testid="approval-row">
              <span className={cn("rounded-full px-2 py-0.5 font-medium", STATUS_STYLE[a.status])}>{t(`apr.status.${a.status}` as MessageKey)}</span>
              <span className="text-neutral-600 dark:text-neutral-300">
                {t("apr.line", { requester: a.requestedBy?.name ?? "—", approver: a.approver.name })}
              </span>
              <span className="text-neutral-400">{formatDate(a.decidedAt ?? a.createdAt, true)}</span>
              {(a.decisionNote || a.note) && <span className="basis-full text-neutral-500">“{a.decisionNote || a.note}”</span>}
              {a.status === "pending" && (
                <span className="ml-auto flex items-center gap-1">
                  {a.approver.id === me && (
                    <>
                      <Button size="sm" onClick={() => decide(a, "approve")} data-testid="approval-approve">
                        <ThumbsUp size={12} /> {t("ac.approve")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => decide(a, "reject")}>
                        <ThumbsDown size={12} /> {t("ac.reject")}
                      </Button>
                    </>
                  )}
                  {a.requestedBy?.id === me && (
                    <Button size="sm" variant="ghost" onClick={() => decide(a, "cancel")}>
                      <X size={12} /> {t("common.cancel")}
                    </Button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-md" data-testid="approval-dialog">
          <DialogTitle className="flex items-center gap-2">
            <BadgeCheck size={15} className="text-indigo-500" /> {t("apr.request")}
          </DialogTitle>
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("apr.approver")}</label>
              {people.length ? (
                <Select className="w-full" value={approverId} onValueChange={setApproverId} options={people.map((p) => ({ value: p.id, label: p.name }))} />
              ) : (
                <p className="text-xs text-neutral-400">{t("apr.noPeople")}</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("apr.note")}</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} placeholder={t("apr.notePh")} className="w-full rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} /> {t("apr.completeOnApprove")}
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={request} disabled={busy || !approverId} data-testid="approval-send">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <BadgeCheck size={13} />} {t("apr.send")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
