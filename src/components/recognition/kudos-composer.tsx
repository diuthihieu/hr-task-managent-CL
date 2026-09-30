"use client";
// Write a thank-you letter: pick the person, see what you did together
// (tasks they finished for you, work done together, comments, on-time rate,
// speed), let AI suggest reasons and draft the body, choose a card design,
// edit the greeting / closing, and send.
import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, Lock, Globe2, History, Wand2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { LinkPicker, type LinkTarget } from "@/components/brain/link-picker";
import { KUDOS_TEMPLATES, type KudosTemplate } from "@/lib/recognition/core";
import { STYLE_META, type PersonLite } from "./shared";
import type { MessageKey } from "@/lib/i18n/core";

const STYLES = ["gratitude", "appreciation", "teamwork", "above_beyond", "mentor"] as const;
const VALUES = ["teamwork", "ownership", "customer", "innovation", "integrity", "growth"] as const;
const nfc = (s: string) => s.normalize("NFC");

interface Fact {
  kind: "did_for_you" | "together" | "commented" | "approved" | "on_time" | "speed" | "reported";
  n: number;
  value?: number;
  tasks: { id: string; title: string }[];
}

export function KudosComposer({ workspaceId, me, to: initialTo, onClose, onSent }: { workspaceId: string; me: { id: string; name: string }; to?: PersonLite | null; onClose: () => void; onSent: () => void }) {
  const { t } = useT();
  const [members, setMembers] = useState<PersonLite[]>([]);
  const [toId, setToId] = useState(initialTo?.id ?? "");
  const [style, setStyle] = useState<(typeof STYLES)[number]>("gratitude");
  const [template, setTemplate] = useState<KudosTemplate>("classic");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [greeting, setGreeting] = useState("");
  const [closing, setClosing] = useState(t("reco.letter.closing.gratitude"));
  const [signature, setSignature] = useState(me.name);
  const [message, setMessage] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [task, setTask] = useState<LinkTarget | null>(null);
  const [picking, setPicking] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [aiReasons, setAiReasons] = useState<string[]>([]);
  const [busy, setBusy] = useState<"ai" | "send" | null>(null);
  const edited = useRef({ greeting: false, closing: false });

  useEffect(() => {
    api.get<PersonLite[]>(`/api/workspaces/${workspaceId}/members`).then((m) => setMembers(m.filter((x) => x.id !== me.id))).catch(() => {});
  }, [workspaceId, me.id]);
  const receiver = members.find((m) => m.id === toId) ?? (initialTo?.id === toId ? initialTo : null);

  // Defaults follow the receiver / style until the writer edits them.
  useEffect(() => {
    if (!edited.current.greeting) setGreeting(receiver ? t("reco.letter.dear", { name: receiver.name }) : "");
  }, [receiver, t]);
  useEffect(() => {
    if (!edited.current.closing) setClosing(t(`reco.letter.closing.${style}` as MessageKey));
  }, [style, t]);
  useEffect(() => {
    if (!toId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the previous person's suggestions
    setFacts(null);
    setAiReasons([]);
    api.get<{ facts: Fact[] }>(`/api/workspaces/${workspaceId}/kudos/context?toId=${toId}`).then((r) => setFacts(r.facts)).catch(() => setFacts([]));
  }, [workspaceId, toId]);

  const factText = (f: Fact) => {
    const tasks = f.tasks.slice(0, 2).map((x) => `“${x.title}”`).join(", ");
    const key = f.kind === "speed" && (f.value ?? 0) < 1 ? "reco.fact.speedFast" : `reco.fact.${f.kind}`;
    const base = t(key as MessageKey, { n: f.n, value: f.value ?? 0 });
    return tasks ? `${base}: ${tasks}` : base;
  };

  async function draft() {
    if (!toId) return toast.error(t("reco.compose.needPerson"));
    setBusy("ai");
    try {
      const r = await api.post<{ title: string; message: string; reasons: string[] }>(`/api/workspaces/${workspaceId}/kudos/draft`, { toId, reason, style });
      if (r.title) setTitle(r.title);
      if (r.message) setMessage(r.message);
      setAiReasons(r.reasons ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }
  async function send() {
    setBusy("send");
    try {
      await api.post(`/api/workspaces/${workspaceId}/kudos`, {
        toId,
        style,
        template,
        greeting: greeting.trim() || undefined,
        closing: [closing.trim(), signature.trim() && signature.trim() !== me.name ? `— ${signature.trim()}` : ""].filter(Boolean).join("\n") || undefined,
        title: title.trim() || t(`reco.style.${style}` as MessageKey),
        message,
        reason: reason.trim() || undefined,
        values,
        taskId: task?.id ?? null,
        isPublic,
      });
      toast.success(t("reco.compose.sent", { name: receiver?.name ?? "" }));
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  const label = "block text-xs font-medium text-neutral-700 dark:text-neutral-200";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogTitle>{t("reco.compose.title")}</DialogTitle>
        <div className="mt-3 grid gap-5 lg:grid-cols-[19rem_1fr] max-h-[78vh] overflow-y-auto thin-scroll" data-testid="kudos-composer">
          <div className="space-y-4 text-xs">
            <label className={label}>
              {t("reco.compose.to")}
              <select value={toId} onChange={(e) => setToId(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm" data-testid="kudos-to">
                <option value="">—</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            {toId && (
              <div className="rounded-xl border border-indigo-100 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/30 p-2.5" data-testid="kudos-facts">
                <p className="flex items-center gap-1.5 font-semibold text-indigo-900 dark:text-indigo-200">
                  <History size={12} /> {t("reco.compose.together")}
                </p>
                {facts === null ? (
                  <Loader2 size={12} className="animate-spin mt-2 text-indigo-400" />
                ) : !facts.length ? (
                  <p className="mt-1 text-neutral-500">{t("reco.compose.noHistory")}</p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {facts.map((f) => (
                      <li key={f.kind}>
                        <button onClick={() => setReason((r) => (r ? `${r}; ${factText(f)}` : factText(f)))} className="text-left hover:text-indigo-700 dark:hover:text-indigo-300" title={t("reco.compose.useFact")} data-testid="kudos-fact">
                          • {factText(f)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <label className={label}>
              {t("reco.compose.reason")}
              <textarea rows={3} value={reason} onChange={(e) => setReason(nfc(e.target.value))} placeholder={t("reco.compose.reasonPh")} className="mt-1 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm" data-testid="kudos-reason" />
            </label>
            <Button size="sm" variant="outline" className="w-full" onClick={draft} disabled={busy !== null} data-testid="kudos-ai">
              {busy === "ai" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {t("reco.compose.ai")}
            </Button>
            {!!aiReasons.length && (
              <div className="space-y-1" data-testid="kudos-ai-reasons">
                <p className="font-medium text-neutral-600 dark:text-neutral-300">{t("reco.compose.aiReasons")}</p>
                {aiReasons.map((r) => (
                  <button key={r} onClick={() => setReason(r)} className="w-full text-left rounded-lg border border-neutral-200 dark:border-neutral-800 px-2 py-1.5 hover:border-indigo-300 inline-flex items-start gap-1.5">
                    <Wand2 size={11} className="mt-0.5 text-indigo-500 shrink-0" /> {r}
                  </button>
                ))}
              </div>
            )}

            <div>
              <p className={label}>{t("reco.compose.template")}</p>
              <div className="mt-1 grid grid-cols-4 gap-1.5" data-testid="kudos-templates">
                {KUDOS_TEMPLATES.map((tpl) => (
                  <button key={tpl} onClick={() => setTemplate(tpl)} className={cn("h-12 rounded-lg text-[9px] font-medium flex items-end justify-center pb-1 border-2", `tpl-${tpl}`, template === tpl ? "!border-indigo-500 ring-2 ring-indigo-500/30" : "")} title={t(`reco.template.${tpl}` as MessageKey)} data-testid={`kudos-template-${tpl}`}>
                    {t(`reco.template.${tpl}` as MessageKey)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className={label}>{t("reco.compose.style")}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {STYLES.map((s) => (
                  <button key={s} onClick={() => setStyle(s)} className={cn("h-7 px-2 rounded-full border", style === s ? "border-amber-400 bg-amber-50 dark:bg-amber-950/40" : "border-neutral-200 dark:border-neutral-800")} data-testid={`kudos-style-${s}`}>
                    {STYLE_META[s].emoji} {t(`reco.style.${s}` as MessageKey)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className={label}>{t("reco.compose.values")}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {VALUES.map((v) => (
                  <button key={v} onClick={() => setValues(values.includes(v) ? values.filter((x) => x !== v) : [...values, v].slice(0, 6))} className={cn("h-6 px-2 rounded-full border", values.includes(v) ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-300 dark:border-neutral-700")}>
                    {t(`reco.value.${v}` as MessageKey)}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative">
              <p className={label}>{t("reco.compose.task")}</p>
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

          {/* The card itself: every line is editable. */}
          <div className={cn("kudos-card-face rounded-2xl p-6 sm:p-9 relative min-h-[30rem] flex flex-col md:sticky md:top-0 self-start w-full", `tpl-${template}`)} data-testid="kudos-paper">
            <span className="absolute right-7 top-6 text-3xl" aria-hidden>
              {STYLE_META[style].emoji}
            </span>
            <input value={title} onChange={(e) => setTitle(nfc(e.target.value))} placeholder={t("reco.compose.titlePh")} className="w-full bg-transparent text-2xl font-semibold outline-none placeholder:opacity-40 pr-12" data-testid="kudos-title" />
            <input
              value={greeting}
              onChange={(e) => {
                edited.current.greeting = true;
                setGreeting(nfc(e.target.value));
              }}
              placeholder={t("reco.compose.greetingPh")}
              className="mt-5 w-full bg-transparent text-[17px] outline-none placeholder:opacity-40"
              data-testid="kudos-greeting"
            />
            <textarea
              rows={8}
              value={message}
              onChange={(e) => setMessage(nfc(e.target.value))}
              placeholder={t("reco.compose.messagePh")}
              className="mt-2 w-full flex-1 bg-transparent text-[17px] leading-8 outline-none resize-none placeholder:opacity-40"
              data-testid="kudos-message"
            />
            <input
              value={closing}
              onChange={(e) => {
                edited.current.closing = true;
                setClosing(nfc(e.target.value));
              }}
              className="mt-3 w-full bg-transparent text-[16px] italic outline-none"
              data-testid="kudos-closing"
            />
            <input value={signature} onChange={(e) => setSignature(nfc(e.target.value))} className="kudos-script mt-1 w-full bg-transparent text-2xl outline-none" data-testid="kudos-signature" />
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
