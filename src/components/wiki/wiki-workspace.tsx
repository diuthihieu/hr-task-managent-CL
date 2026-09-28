"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronDown, ChevronRight, FileText, Plus, Trash2, Sparkles, Lock, Users } from "lucide-react";
import { WikiShareDialog } from "./wiki-share-dialog";
import { WikiAiPanel } from "@/components/ai/wiki-ai-panel";
import { RichEditor, type SaveState } from "@/components/editor/rich-editor";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { AiWikiActions } from "@/components/ai/ai-actions";
import { WikiComments } from "./wiki-comments";
import { api } from "@/lib/api-client";
import { formatDate, cn } from "@/lib/utils";
import type { WikiPageSummary, WikiRow } from "@/lib/wiki";

interface WikiPageFull extends WikiPageSummary {
  content: string | null;
}

/** Project wiki: page tree on the left, the selected page (rich editor) on the right. */
export function WikiWorkspace({ wiki, workspaceSlug, workspaceId, pageId, currentUserName, currentUserId }: { wiki: WikiRow; workspaceSlug: string; workspaceId: string; pageId: string | null; currentUserName: string; currentUserId?: string }) {
  const { t } = useT();
  const router = useRouter();
  const base = `/w/${workspaceSlug}/wiki/${wiki.id}`;
  const canEdit = wiki.myRole === "editor" || wiki.myRole === "manager";
  const canManage = wiki.myRole === "manager";
  const [shareOpen, setShareOpen] = useState(false);
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [page, setPage] = useState<WikiPageFull | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [aiOpen, setAiOpen] = useState(false);

  const loadTree = useCallback(async () => {
    try {
      setPages(await api.get<WikiPageSummary[]>(`/api/wikis/${wiki.id}/pages`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }, [wiki.id, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    if (!pageId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the selection when the URL has no page
      setPage(null);
      return;
    }
    let cancelled = false;
    api
      .get<WikiPageFull>(`/api/wiki/${pageId}`)
      .then((p) => !cancelled && setPage(p))
      .catch(() => {
        if (!cancelled) router.replace(base);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId, base, router]);

  const children = useMemo(() => {
    const map = new Map<string | null, WikiPageSummary[]>();
    for (const p of pages) {
      const k = p.parentPageId;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return map;
  }, [pages]);

  async function create(parentPageId: string | null) {
    try {
      const p = await api.post<WikiPageSummary>(`/api/wikis/${wiki.id}/pages`, { title: t("wiki.untitled"), parentPageId });
      await loadTree();
      router.push(`${base}/${p.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function rename(title: string) {
    if (!page || !title.trim() || title === page.title) return;
    try {
      await api.patch(`/api/wiki/${page.id}`, { title: title.trim() });
      setPage({ ...page, title: title.trim() });
      loadTree();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function remove() {
    if (!page || !confirm(t("wiki.deleteConfirm", { name: page.title }))) return;
    try {
      await api.delete(`/api/wiki/${page.id}`);
      await loadTree();
      router.push(base);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function uploadImage(file: File): Promise<string> {
    if (!page) throw new Error(t("common.failed"));
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/wiki/${page.id}/attachments`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
    return body.inlineUrl as string;
  }

  function renderTree(parent: string | null, depth: number): React.ReactNode {
    const list = children.get(parent) ?? [];
    return (
      <>
        {list.map((p) => {
          const kids = children.get(p.id) ?? [];
          const open = !collapsed.has(p.id);
          return (
            <div key={p.id}>
              <div className={cn("group flex items-center gap-1 rounded-md pr-1 text-sm", p.id === pageId ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800")} style={{ paddingLeft: 4 + depth * 14 }}>
                <button
                  onClick={() => setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(p.id)) next.delete(p.id);
                    else next.add(p.id);
                    return next;
                  })}
                  className={cn("text-neutral-400 w-4 shrink-0", !kids.length && "invisible")}
                  aria-label={t("common.open")}
                >
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <Link href={`${base}/${p.id}`} className="flex items-center gap-1.5 flex-1 min-w-0 py-1" data-testid="wiki-tree-item">
                  {p.icon ? <span>{p.icon}</span> : <FileText size={13} className="shrink-0 opacity-60" />}
                  <span className="truncate">{p.title}</span>
                </Link>
                {canEdit && (
                  <button onClick={() => create(p.id)} className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700" title={t("wiki.newSubpage")}>
                    <Plus size={12} />
                  </button>
                )}
              </div>
              {open && kids.length > 0 && renderTree(p.id, depth + 1)}
            </div>
          );
        })}
      </>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className={cn("md:w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex-col", page ? "hidden md:flex" : "flex w-full")}>
        <div className="flex items-center gap-2 px-3 h-11 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <span className="h-6 w-6 rounded-md flex items-center justify-center text-sm shrink-0 font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
            {wiki.icon || <BookOpen size={13} />}
          </span>
          <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 truncate" title={wiki.name}>{wiki.name}</span>
          {wiki.access === "restricted" && <Lock size={11} className="text-neutral-400 shrink-0" />}
          {canEdit && (
            <button onClick={() => create(null)} className="ml-auto text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" title={t("wiki.newPage")} data-testid="wiki-new-page">
              <Plus size={15} />
            </button>
          )}
        </div>
        <div className="p-2 border-b border-neutral-200 dark:border-neutral-800">
          <button
            onClick={() => setAiOpen((v) => !v)}
            className={cn(
              "w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
              aiOpen ? "bg-indigo-600 text-white" : "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100"
            )}
            data-testid="wiki-ask-ai"
          >
            <Sparkles size={14} /> {t("wikiAi.ask")}
          </button>
          <button onClick={() => setShareOpen(true)} className="mt-1.5 w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800" data-testid="wiki-share">
            <Users size={13} /> {canManage ? t("wikis.share") : t("wikis.whoHasAccess")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto thin-scroll p-2">
          {renderTree(null, 0)}
        </div>
      </aside>

      <div className={cn("flex-1 overflow-y-auto thin-scroll", !page && "hidden md:block")}>
        {!page ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-500">
            <BookOpen size={36} className="text-indigo-400 mb-3" />
            {pages.length === 0 ? (
              <>
                <h2 className="font-semibold text-neutral-800 dark:text-neutral-100">{t("wiki.empty.title")}</h2>
                <p className="text-sm mt-1 max-w-md">{t("wiki.empty.body")}</p>
              </>
            ) : (
              <p className="text-sm">{t("wiki.select")}</p>
            )}
            {canEdit && (
              <Button className="mt-4" onClick={() => create(null)}>
                <Plus size={14} /> {t("wiki.newPage")}
              </Button>
            )}
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-4 sm:px-8 py-5 sm:py-8" key={`${page.id}:${page.updatedAt}`}>
            <Link href={base} className="md:hidden inline-flex items-center gap-1 text-xs text-neutral-500 mb-3">
              <ChevronRight size={12} className="rotate-180" /> {wiki.name}
            </Link>
            <div className="flex items-center gap-2 text-[11px] text-neutral-400 mb-2">
              <span>{t("wiki.lastEdited", { name: page.updatedBy ?? currentUserName, when: formatDate(page.updatedAt, true) })}</span>
              <span className="ml-auto" data-testid="wiki-save-state">
                {saveState === "saving" ? t("editor.saving") : saveState === "saved" ? t("editor.saved") : saveState === "error" ? t("editor.error") : ""}
              </span>
              <AiWikiActions
                pageId={page.id}
                workspaceId={workspaceId}
                canEdit={canEdit}
                onApplied={() => api.get<WikiPageFull>(`/api/wiki/${page.id}`).then(setPage).catch(() => {})}
              />
              {canEdit && (
                <button onClick={remove} className="flex items-center gap-1 hover:text-red-600">
                  <Trash2 size={12} /> {t("common.delete")}
                </button>
              )}
            </div>
            <input
              defaultValue={page.title}
              disabled={!canEdit}
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              placeholder={t("wiki.pageTitle")}
              className="w-full bg-transparent text-3xl font-bold text-neutral-900 dark:text-neutral-50 outline-none mb-4"
              data-testid="wiki-title"
            />
            <RichEditor
              content={page.content}
              editable={canEdit}
              onSaveStateChange={setSaveState}
              onUploadImage={uploadImage}
              minHeight={420}
              onSave={async (html) => {
                await api.patch(`/api/wiki/${page.id}`, { content: html || null });
              }}
            />
            <WikiComments pageId={page.id} currentUserId={currentUserId ?? null} canManage={wiki.myRole === "manager"} />
          </div>
        )}
      </div>
      {aiOpen && <WikiAiPanel wikiId={wiki.id} wikiName={wiki.name} onClose={() => setAiOpen(false)} />}
      {shareOpen && <WikiShareDialog wiki={wiki} workspaceId={workspaceId} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
