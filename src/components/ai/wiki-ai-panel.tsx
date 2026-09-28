"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X, Settings2, MessageSquare, History, Plus, Trash2, Upload, FileText, Loader2, Eye } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Textarea, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import { ChatThread } from "./chat-thread";
import { useAiChat } from "./use-ai-chat";

interface AiSettings {
  configured: boolean;
  model?: string;
  canManage: boolean;
  enabled: boolean;
  greeting: string | null;
  instructions?: string;
  docCount: number;
  pageCount: number;
}
interface Doc {
  id: string;
  fileName: string;
  sizeBytes: number;
  charCount: number;
  createdAt: string;
  createdBy: string | null;
}

/** Right-hand panel in the project wiki: ask the wiki assistant, and (for project managers) set it up. */
export function WikiAiPanel({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<"chat" | "settings">("chat");
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const chat = useAiChat({ kind: "wiki", projectId });

  const loadSettings = useCallback(async () => {
    setSettings(await api.get<AiSettings>(`/api/projects/${projectId}/ai-settings`));
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadSettings().catch(() => {});
    chat.loadConversations().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per project
  }, [projectId]);

  return (
    <aside className="w-[420px] shrink-0 border-l border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 flex flex-col" data-testid="wiki-ai-panel">
      <div className="h-11 px-3 flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shrink-0">
        <Sparkles size={15} className="text-indigo-600" />
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 truncate">{t("wikiAi.title")}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {tab === "chat" && (
            <>
              <button onClick={() => chat.open(null)} className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("ai.newChat")}>
                <Plus size={15} />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("ai.history")}>
                    <History size={15} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 max-h-80 overflow-y-auto">
                  <DropdownMenuLabel>{t("ai.history")}</DropdownMenuLabel>
                  {chat.conversations.length === 0 && <div className="px-2 py-2 text-xs text-neutral-400">{t("ai.noHistory")}</div>}
                  {chat.conversations.map((c) => (
                    <DropdownMenuItem key={c.id} onSelect={() => chat.open(c.id)}>
                      <span className="truncate flex-1">{c.title}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {settings?.canManage && (
            <button onClick={() => setTab(tab === "chat" ? "settings" : "chat")} className={cn("rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800", tab === "settings" ? "text-indigo-600" : "text-neutral-500")} title={tab === "chat" ? t("wikiAi.settings") : t("wikiAi.chat")} data-testid="wiki-ai-settings-tab">
              {tab === "chat" ? <Settings2 size={15} /> : <MessageSquare size={15} />}
            </button>
          )}
          <button onClick={onClose} className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t("common.close")}>
            <X size={15} />
          </button>
        </div>
      </div>

      {tab === "settings" && settings?.canManage ? (
        <WikiAiSettings projectId={projectId} settings={settings} onSaved={loadSettings} />
      ) : settings && !settings.enabled ? (
        <div className="p-6 text-sm text-neutral-500 text-center">{t("wikiAi.disabled")}</div>
      ) : (
        <ChatThread
          compact
          messages={chat.messages}
          busy={chat.busy}
          error={chat.error}
          configured={chat.configured}
          onSend={chat.send}
          onStop={chat.stop}
          emptyTitle={t("wikiAi.emptyTitle", { project: projectName })}
          emptyBody={settings?.greeting || t("wikiAi.emptyBody", { pages: settings?.pageCount ?? 0, docs: settings?.docCount ?? 0 })}
          suggestions={[t("wikiAi.s1"), t("wikiAi.s2"), t("wikiAi.s3")]}
          placeholder={t("wikiAi.placeholder")}
        />
      )}
    </aside>
  );
}

function WikiAiSettings({ projectId, settings, onSaved }: { projectId: string; settings: AiSettings; onSaved: () => void }) {
  const { t } = useT();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [instructions, setInstructions] = useState(settings.instructions ?? "");
  const [greeting, setGreeting] = useState(settings.greeting ?? "");
  const [saving, setSaving] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ fileName: string; text: string; truncated: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => setDocs(await api.get<Doc[]>(`/api/projects/${projectId}/knowledge-docs`)), [projectId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadDocs().catch(() => {});
  }, [loadDocs]);

  async function save() {
    setSaving(true);
    try {
      await api.put(`/api/projects/${projectId}/ai-settings`, { enabled, instructions, greeting: greeting.trim() || null });
      toast.success(t("common.saved"));
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function upload(files: FileList) {
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/projects/${projectId}/knowledge-docs`, { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || t("common.failed"));
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : t("common.failed")}`);
      }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    loadDocs();
    onSaved();
  }

  async function remove(d: Doc) {
    if (!confirm(t("wikiAi.removeDoc", { name: d.fileName }))) return;
    await api.delete(`/api/knowledge-docs/${d.id}`).catch((e) => toast.error(e.message));
    loadDocs();
    onSaved();
  }

  const label = "text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1 block";
  return (
    <div className="flex-1 overflow-y-auto thin-scroll p-4 space-y-5" data-testid="wiki-ai-settings">
      <div className="flex items-center justify-between rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2.5">
        <div>
          <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{t("wikiAi.enable")}</div>
          <div className="text-[11px] text-neutral-500">{t("wikiAi.enableHint")}</div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <div>
        <label className={label}>{t("wikiAi.instructions")}</label>
        <Textarea rows={9} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t("wikiAi.instructionsPh")} data-testid="wiki-ai-instructions" />
        <p className="text-[11px] text-neutral-400 mt-1">{t("wikiAi.instructionsHint")}</p>
      </div>
      <div>
        <label className={label}>{t("wikiAi.greeting")}</label>
        <Input value={greeting} onChange={(e) => setGreeting(e.target.value)} maxLength={500} placeholder={t("wikiAi.greetingPh")} />
      </div>
      <Button onClick={save} disabled={saving} className="w-full" data-testid="wiki-ai-save">
        {t("common.save")}
      </Button>

      <div>
        <label className={label}>{t("wikiAi.docs")}</label>
        <p className="text-[11px] text-neutral-500 mb-2">{t("wikiAi.docsHint")}</p>
        <button onClick={() => !uploading && fileRef.current?.click()} className="w-full flex flex-col items-center gap-1 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 py-4 text-xs text-neutral-600 hover:border-indigo-400" data-testid="wiki-ai-upload">
          {uploading ? <Loader2 size={16} className="animate-spin text-indigo-600" /> : <Upload size={16} className="text-neutral-400" />}
          {uploading ? t("wikiAi.reading", { name: uploading }) : t("wikiAi.uploadDocs")}
          <span className="text-[10px] text-neutral-400">{t("wikiAi.docTypes")}</span>
        </button>
        <input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv,.json,.html,.htm,.png,.jpg,.jpeg,.webp" onChange={(e) => e.target.files && upload(e.target.files)} data-testid="wiki-ai-file" />
        <ul className="mt-2 space-y-1.5">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2.5 py-2 text-xs" data-testid="wiki-ai-doc">
              <FileText size={14} className="text-indigo-500 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium text-neutral-800 dark:text-neutral-100">{d.fileName}</span>
                <span className="block text-[10px] text-neutral-400">
                  {t("wikiAi.chars", { count: d.charCount.toLocaleString() })} · {formatDate(d.createdAt)}
                </span>
              </span>
              <button onClick={async () => setPreview(await api.get(`/api/knowledge-docs/${d.id}`))} className="text-neutral-400 hover:text-indigo-600" title={t("wikiAi.preview")}>
                <Eye size={13} />
              </button>
              <button onClick={() => remove(d)} className="text-neutral-400 hover:text-red-600" title={t("common.delete")}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[10px] text-neutral-400">{t("wikiAi.howItWorks", { model: settings.model ?? "" })}</p>

      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>{preview?.fileName}</DialogTitle>
          <pre className="max-h-[60vh] overflow-auto thin-scroll whitespace-pre-wrap text-xs bg-neutral-50 dark:bg-neutral-900 rounded-lg p-3">{preview?.text}</pre>
          {preview?.truncated && <p className="text-[11px] text-neutral-400">{t("wikiAi.previewTruncated")}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
