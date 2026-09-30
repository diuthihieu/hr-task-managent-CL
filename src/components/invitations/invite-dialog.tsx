"use client";
import { useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Mail, RefreshCw, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";

export interface InviteLinkState {
  enabled: boolean;
  url: string | null;
  role: string;
  uses: number;
  expiresAt: string | null;
}
interface InviteResult {
  email: string;
  status: "invited" | "already_member" | "reinvited";
  url: string | null;
  hasAccount: boolean;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function copy(text: string, t: (k: MessageKey) => string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("inv.copied"));
  } catch {
    window.prompt(t("inv.copyManually"), text);
  }
}

/**
 * Invite people to a workspace: by email (each gets an invitation to accept)
 * or with the shareable join link. Workspace admins only.
 */
export function InviteDialog({ open, onOpenChange, workspaceId, workspaceName, onInvited }: { open: boolean; onOpenChange: (v: boolean) => void; workspaceId: string; workspaceName?: string; onInvited?: () => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<"email" | "link">("email");
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState("editor");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [link, setLink] = useState<InviteLinkState | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get<InviteLinkState>(`/api/workspaces/${workspaceId}/invite-link`).then(setLink).catch(() => {});
  }, [open, workspaceId]);

  function reset() {
    setEmails([]);
    setDraft("");
    setMessage("");
    setResults(null);
  }

  /** Commits typed addresses; accepts pasted lists separated by commas, spaces, semicolons or new lines. */
  function commit(text: string) {
    const parts = text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const bad = parts.filter((p) => !EMAIL.test(p));
    const good = parts.filter((p) => EMAIL.test(p));
    if (good.length) setEmails((prev) => [...new Set([...prev, ...good])].slice(0, 50));
    setDraft(bad.join(" "));
    if (bad.length) toast.error(t("inv.badEmail", { email: bad[0] }));
  }

  async function send() {
    const all = draft.trim() ? [...emails, ...draft.split(/[\s,;]+/).filter((x) => EMAIL.test(x.trim().toLowerCase())).map((x) => x.trim().toLowerCase())] : emails;
    if (!all.length) return;
    setBusy(true);
    try {
      const r = await api.post<{ invitations: InviteResult[] }>(`/api/workspaces/${workspaceId}/members`, { emails: [...new Set(all)], role, message: message.trim() || null });
      setResults(r.invitations);
      setEmails([]);
      setDraft("");
      onInvited?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function updateLink(body: { role?: string; regenerate?: boolean; expiresInDays?: number | null } | "off") {
    setLinkBusy(true);
    try {
      const next = body === "off" ? await api.delete<InviteLinkState>(`/api/workspaces/${workspaceId}/invite-link`) : await api.post<InviteLinkState>(`/api/workspaces/${workspaceId}/invite-link`, body);
      setLink(next as InviteLinkState);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setLinkBusy(false);
    }
  }

  const roles = ["admin", "editor", "contributor", "viewer"].map((r) => ({ value: r, label: t(`role.${r}` as MessageKey) }));
  const linkRoles = ["editor", "contributor", "viewer"].map((r) => ({ value: r, label: t(`role.${r}` as MessageKey) }));

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle>{workspaceName ? t("inv.title", { name: workspaceName }) : t("inv.titlePlain")}</DialogTitle>
        <div className="flex gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1 mb-4" role="tablist">
          {(
            [
              ["email", Mail, t("inv.byEmail")],
              ["link", Link2, t("inv.byLink")],
            ] as const
          ).map(([k, Icon, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("flex-1 inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm", tab === k ? "bg-white dark:bg-neutral-900 shadow-sm font-medium text-neutral-900 dark:text-neutral-50" : "text-neutral-500")} data-testid={`invite-tab-${k}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {tab === "email" ? (
          results ? (
            <div data-testid="invite-results">
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-800">
                {results.map((r) => (
                  <li key={r.email} className="flex items-center gap-2 px-3 py-2 text-sm">
                    {r.status === "already_member" ? <Check size={14} className="text-neutral-400 shrink-0" /> : <Mail size={14} className="text-indigo-600 shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{r.email}</span>
                      <span className="block text-[11px] text-neutral-500">
                        {r.status === "already_member" ? t("inv.res.member") : r.hasAccount ? t("inv.res.notified") : t("inv.res.noAccount")}
                      </span>
                    </span>
                    {r.url && (
                      <button onClick={() => copy(r.url!, t)} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline shrink-0" data-testid="invite-copy-personal">
                        <Copy size={12} /> {t("inv.copyLink")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-neutral-500 mt-2">{t("inv.resHint")}</p>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="secondary" onClick={() => setResults(null)}>{t("inv.inviteMore")}</Button>
                <Button onClick={() => { reset(); onOpenChange(false); }}>{t("common.close")}</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("inv.emails")}</label>
                <div className="flex flex-wrap gap-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 px-2 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500/40 min-h-10">
                  {emails.map((e) => (
                    <span key={e} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 pl-2 pr-1 py-0.5 text-xs" data-testid="invite-chip">
                      {e}
                      <button onClick={() => setEmails((prev) => prev.filter((x) => x !== e))} aria-label={t("common.remove")} className="hover:text-red-600">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => (/[\s,;]$/.test(e.target.value) ? commit(e.target.value) : setDraft(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (draft.trim()) commit(draft);
                        else if (emails.length) send();
                      } else if (e.key === "Backspace" && !draft && emails.length) setEmails((prev) => prev.slice(0, -1));
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      commit(draft + " " + e.clipboardData.getData("text"));
                    }}
                    onBlur={() => draft.trim() && commit(draft)}
                    placeholder={emails.length ? "" : "name@company.com, ..."}
                    className="flex-1 min-w-40 bg-transparent text-sm outline-none py-0.5"
                    data-testid="invite-email-input"
                  />
                </div>
                <p className="text-[11px] text-neutral-400 mt-1">{t("inv.emailsHint")}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("common.role")}</label>
                <Select className="w-full" value={role} onValueChange={setRole} options={roles} />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("inv.message")}</label>
                <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder={t("inv.messagePh")} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
                <Button onClick={send} disabled={busy || (!emails.length && !EMAIL.test(draft.trim().toLowerCase()))} data-testid="invite-send">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} {t("inv.send")}
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="space-y-3" data-testid="invite-link-panel">
            <p className="text-sm text-neutral-600 dark:text-neutral-300">{t("inv.linkHint")}</p>
            {!link ? (
              <p className="text-sm text-neutral-400">{t("common.loading")}</p>
            ) : link.enabled && link.url ? (
              <>
                <div className="flex gap-2">
                  <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" data-testid="invite-link-url" />
                  <Button onClick={() => copy(link.url!, t)} data-testid="invite-link-copy">
                    <Copy size={13} /> {t("inv.copy")}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("inv.linkRole")}</label>
                    <Select className="w-full" value={link.role} onValueChange={(v) => updateLink({ role: v })} options={linkRoles} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("inv.linkExpiry")}</label>
                    <Select
                      className="w-full"
                      value={link.expiresAt ? "keep" : "never"}
                      onValueChange={(v) => v !== "keep" && updateLink({ expiresInDays: v === "never" ? null : Number(v) })}
                      options={[
                        ...(link.expiresAt ? [{ value: "keep", label: t("inv.expiresOn", { date: new Date(link.expiresAt).toLocaleDateString() }) }] : []),
                        { value: "never", label: t("inv.never") },
                        { value: "7", label: t("inv.days", { count: 7 }) },
                        { value: "30", label: t("inv.days", { count: 30 }) },
                      ]}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-neutral-500">{t("inv.linkUses", { count: link.uses })}</p>
                <div className="flex flex-wrap justify-between gap-2 pt-1">
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => confirm(t("inv.regenConfirm")) && updateLink({ regenerate: true })} disabled={linkBusy} data-testid="invite-link-regen">
                      <RefreshCw size={12} /> {t("inv.regen")}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => updateLink("off")} disabled={linkBusy} data-testid="invite-link-off">
                      {t("inv.turnOff")}
                    </Button>
                  </div>
                  <Button size="sm" onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-4 text-center">
                <p className="text-sm text-neutral-500 mb-3">{t("inv.linkOff")}</p>
                <Button onClick={() => updateLink({ role: "contributor" })} disabled={linkBusy} data-testid="invite-link-on">
                  {linkBusy ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />} {t("inv.turnOn")}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
