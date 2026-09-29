"use client";
// Write a thank-you letter: stationery-style editor with a greeting, the
// letter, a signature, letter styles, values, optional link to a task, and an
// AI helper that turns your own words into a warm letter (you edit it).
import { useEffect, useState } from "react";
import { Loader2, Send, Sparkles, Lock, Globe2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { LinkPicker, type LinkTarget } from "@/components/brain/link-picker";
import { STYLE_META, type PersonLite } from "./shared";
import type { MessageKey } from "@/lib/i18n/core";

const STYLES = ["gratitude", "appreciation", "teamwork", "above_beyond", "mentor"] as const;
const VALUES = ["teamwork", "ownership", "customer", "innovation", "integrity", "growth"] as const;

export function KudosComposer({ workspaceId, me, to: initialTo, onClose, onSent }: { workspaceId: string; me: { id: string; name: string }; to?: PersonLite | null; onClose: () => void; onSent: () => void }) {
  const { t } = useT();
  const [members, setMembers] = useState<PersonLite[]>([]);
  const [toId, setToId] = useState(initialTo?.id ?? "");
  const [style, setStyle] = useState<(typeof STYLES)[number]>("gratitude");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [task, setTask] = useState<LinkTarget | null>(null);
  const [picking, setPicking] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState<"ai" | "send" | null>(null);

  useEffect(() => {
    api.get<PersonLite[]>(`/api/workspaces/${workspaceId}/members`).then((m) => setMembers(m.filter((x) => x.id !== me.id))).catch(() => {});
  }, [workspaceId, me.id]);
  const receiver = members.find((m) => m.id === toId) ?? initialTo ?? null;

  async function draft() {
    if (!toId || reason.trim().length < 3) return toast.error(t("reco.compose.needReason"));
    setBusy("ai");
    try {
      const r = await api.post<{ title: string; message: string }>(`/api/workspaces/${workspaceId}/kudos/draft`, { toId, reason, style });
      if (r.title) setTitle(r.title);
      if (r.message) setMessage(r.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }
  async function send() {
    setBusy("send");
    try {
      await api.post(`/api/workspaces/${workspaceId}/kudos`, { toId, style, title: title.trim() || t(`reco.style.${style}` as MessageKey), message, reason: reason.trim() || undefined, values, taskId: task?.id ?? null, isPublic });
      toast.success(t("reco.compose.sent", { name: receiver?.name ?? "" }));
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogTitle>{t("reco.compose.title")}</DialogTitle>
        <div className="mt-3 grid gap-4 md:grid-cols-[14rem_1fr] max-h-[75vh] overflow-y-auto thin-scroll" data-testid="kudos-composer">
          <div className="space-y-3 text-xs">
            <label className="block font-medium text-neutral-600 dark:text-neutral-300">
              {t("reco.compose.to")}
              <select value={toId} onChange={(e) => setToId(e.target.value)} className="mt-1 h-8 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm" data-testid="kudos-to">
                <option value="">—</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <p className="font-medium text-neutral-600 dark:text-neutral-300">{t("reco.compose.style")}</p>
              <div className="mt-1 grid grid-cols-1 gap-1">
                {STYLES.map((s) => (
                  <button key={s} onClick={() => setStyle(s)} className={cn("h-8 px-2 rounded-lg border text-left", style === s ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40" : "border-neutral-200 dark:border-neutral-800")} data-testid={`kudos-style-${s}`}>
                    {STYLE_META[s].emoji} {t(`reco.style.${s}` as MessageKey)}
                  </button>
                ))}
              </div>
            </div>
            <label className="block font-medium text-neutral-600 dark:text-neutral-300">
              {t("reco.compose.reason")}
              <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reco.compose.reasonPh")} className="mt-1 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm" data-testid="kudos-reason" />
            </label>
            <Button size="sm" variant="outline" className="w-full" onClick={draft} disabled={busy !== null} data-testid="kudos-ai">
              {busy === "ai" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {t("reco.compose.ai")}
            </Button>
            <div>
              <p className="font-medium text-neutral-600 dark:text-neutral-300">{t("reco.compose.values")}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {VALUES.map((v) => (
                  <button key={v} onClick={() => setValues(values.includes(v) ? values.filter((x) => x !== v) : [...values, v].slice(0, 6))} className={cn("h-6 px-2 rounded-full border", values.includes(v) ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-300 dark:border-neutral-700")}>
                    {t(`reco.value.${v}` as MessageKey)}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative">
              <p className="font-medium text-neutral-600 dark:text-neutral-300">{t("reco.compose.task")}</p>
              {task ? (
                <p className="mt-1">
                  {task.label}{" "}
                  <button className="text-neutral-400" onClick={() => setTask(null)}>
                    ×
                  </button>
                </p>
              ) : (
                <button onClick={() => setPicking(true)} className="mt-1 text-indigo-600 hover:underline">
                  {t("reco.compose.pickTask")}
                </button>
              )}
              {picking && (
                <div className="absolute z-50 top-6">
                  <LinkPicker workspaceId={workspaceId} types={["task"]} onPick={(x) => { setTask(x); setPicking(false); }} onClose={() => setPicking(false)} />
                </div>
              )}
            </div>
            <button onClick={() => setIsPublic(!isPublic)} className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-300" data-testid="kudos-public">
              {isPublic ? <Globe2 size={12} /> : <Lock size={12} />} {isPublic ? t("reco.compose.public") : t("reco.compose.private")}
            </button>
          </div>

          {/* The letter itself */}
          <div className="kudos-paper rounded-2xl p-6 sm:p-8 font-serif relative" data-testid="kudos-paper">
            <span className="absolute right-6 top-5 text-3xl" aria-hidden>
              {STYLE_META[style].emoji}
            </span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("reco.compose.titlePh")} className="w-full bg-transparent text-xl font-semibold outline-none placeholder:text-amber-900/40 pr-10" data-testid="kudos-title" />
            <p className="mt-4 text-[15px]">{t("reco.letter.dear", { name: receiver?.name ?? "…" })}</p>
            <textarea
              rows={9}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("reco.compose.messagePh")}
              className="mt-2 w-full bg-transparent text-[15px] leading-8 outline-none resize-none placeholder:text-amber-900/40"
              data-testid="kudos-message"
            />
            <p className="mt-2 text-[15px] italic">{t(`reco.letter.closing.${style}` as MessageKey)}</p>
            <p className="mt-1 text-lg" style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive" }}>
              {me.name}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={send} disabled={busy !== null || !toId || message.trim().length < 10} data-testid="kudos-send">
            {busy === "send" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {t("reco.compose.send")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
