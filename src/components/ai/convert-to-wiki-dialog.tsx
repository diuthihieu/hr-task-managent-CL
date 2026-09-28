"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { markdownToHtml } from "./markdown";

interface WikiLite {
  id: string;
  name: string;
  myRole: "viewer" | "editor" | "manager" | null;
}
interface PageLite {
  id: string;
  title: string;
  parentPageId: string | null;
}

/**
 * Save an AI answer as a wiki page: pick one of the wikis the user can edit
 * (and optionally a parent page), adjust the title, create the page, open it.
 */
export function ConvertToWikiDialog({ markdown, workspaceId, workspaceSlug, onClose }: { markdown: string | null; workspaceId: string; workspaceSlug: string; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const [wikis, setWikis] = useState<WikiLite[] | null>(null);
  const [wikiId, setWikiId] = useState("");
  const [pages, setPages] = useState<PageLite[]>([]);
  const [parentId, setParentId] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (markdown === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per answer being converted
    setTitle(markdown.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 300) || t("c2w.defaultTitle"));
    api
      .get<WikiLite[]>(`/api/workspaces/${workspaceId}/wikis`)
      .then((all) => {
        const editable = all.filter((w) => w.myRole === "editor" || w.myRole === "manager");
        setWikis(editable);
        setWikiId((cur) => cur || editable[0]?.id || "");
      })
      .catch(() => setWikis([]));
  }, [markdown, workspaceId, t]);

  useEffect(() => {
    if (!wikiId) return;
    setParentId(""); // eslint-disable-line react-hooks/set-state-in-effect -- the parent belongs to the chosen wiki
    api.get<PageLite[]>(`/api/wikis/${wikiId}/pages`).then(setPages).catch(() => setPages([]));
  }, [wikiId]);

  async function create() {
    if (!markdown || !wikiId || !title.trim()) return;
    setBusy(true);
    try {
      // Drop the leading "# Title" line - it becomes the page title.
      const body = markdown.replace(/^#\s+.+\n?/, "").trim();
      const page = await api.post<{ id: string }>(`/api/wikis/${wikiId}/pages`, { title: title.trim(), parentPageId: parentId || null, content: markdownToHtml(body) });
      toast.success(t("c2w.done"));
      onClose();
      router.push(`/w/${workspaceSlug}/wiki/${wikiId}/${page.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  const label = "text-xs font-medium text-neutral-500 mb-1 block";
  return (
    <Dialog open={markdown !== null} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md" data-testid="convert-to-wiki">
        <DialogTitle className="flex items-center gap-2">
          <BookOpen size={15} className="text-indigo-500" /> {t("c2w.title")}
        </DialogTitle>
        {wikis === null ? (
          <div className="py-6 flex justify-center">
            <Loader2 size={18} className="animate-spin text-neutral-400" />
          </div>
        ) : wikis.length === 0 ? (
          <p className="text-sm text-neutral-500 py-4">{t("c2w.noWiki")}</p>
        ) : (
          <div className="space-y-3 mt-2">
            <div>
              <label className={label}>{t("c2w.wiki")}</label>
              <Select className="w-full" value={wikiId} onValueChange={setWikiId} options={wikis.map((w) => ({ value: w.id, label: w.name }))} />
            </div>
            <div>
              <label className={label}>{t("c2w.parent")}</label>
              <Select className="w-full" value={parentId} onValueChange={setParentId} options={[{ value: "", label: t("c2w.topLevel") }, ...pages.map((p) => ({ value: p.id, label: p.title || t("common.untitled") }))]} />
            </div>
            <div>
              <label className={label}>{t("c2w.pageTitle")}</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} data-testid="c2w-title" />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={create} disabled={busy || !wikiId || !title.trim()} data-testid="c2w-create">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <BookOpen size={13} />} {t("c2w.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
