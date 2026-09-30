"use client";
// AI retrospective for a finished task or project: the AI drafts, the person
// edits and chooses what to keep, then it is saved as a wiki page (status
// "draft", AI-generated, linked to its source) plus optional decisions.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import type { RetroDraft } from "@/lib/brain/retro";

export function RetroButton({ taskId, projectId, className }: { taskId?: string; projectId?: string; className?: string }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<RetroDraft | null>(null);
  const [source, setSource] = useState("");
  const [wikis, setWikis] = useState<{ id: string; name: string; myRole: string | null }[]>([]);
  const [wikiId, setWikiId] = useState("");
  const [keep, setKeep] = useState<Set<number>>(new Set());

  async function generate() {
    setOpen(true);
    setBusy(true);
    setDraft(null);
    try {
      const r = await api.post<{ draft: RetroDraft; source: string; workspaceId: string }>(`/api/brain/retro`, taskId ? { taskId } : { projectId });
      setDraft(r.draft);
      setSource(r.source);
      setKeep(new Set(r.draft.decisions.map((_, i) => i)));
      const w = (await api.get<{ id: string; name: string; myRole: string | null }[]>(`/api/workspaces/${r.workspaceId}/wikis`)).filter((x) => x.myRole === "editor" || x.myRole === "manager");
      setWikis(w);
      setWikiId(w[0]?.id ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft || !wikiId) return;
    setBusy(true);
    try {
      const r = await api.post<{ href: string }>(`/api/brain/retro/save`, { wikiId, source, draft, saveDecisions: [...keep] });
      toast.success(t("brain.retro.saved"));
      setOpen(false);
      router.push(r.href);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }
  const lines = (xs: string[]) => xs.join("\n");
  const split = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  return (
    <>
      <Button size="sm" variant="outline" className={className} onClick={generate} data-testid="retro-button">
        <History size={13} /> {t("brain.retro.button")}
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="max-w-2xl">
            <DialogTitle className="inline-flex items-center gap-2">
              <Sparkles size={16} className="text-indigo-600" /> {t("brain.retro.title")}
            </DialogTitle>
            {!draft ? (
              <div className="py-10 flex flex-col items-center gap-2 text-sm text-neutral-500">
                <Loader2 className="animate-spin" size={18} /> {t("brain.retro.generating")}
              </div>
            ) : (
              <div className="mt-3 space-y-3 max-h-[65vh] overflow-y-auto thin-scroll pr-1 text-xs" data-testid="retro-draft">
                <p className="text-purple-700 dark:text-purple-300">{t("brain.retro.draftNote")}</p>
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} data-testid="retro-title" />
                <label className="block font-medium">
                  {t("brain.retro.retrospective")}
                  <Textarea className="mt-1" rows={4} value={draft.retrospective} onChange={(e) => setDraft({ ...draft, retrospective: e.target.value })} />
                </label>
                <label className="block font-medium">
                  {t("brain.retro.lessons")} <span className="text-neutral-400 font-normal">({t("brain.retro.onePerLine")})</span>
                  <Textarea className="mt-1" rows={4} value={lines(draft.lessons)} onChange={(e) => setDraft({ ...draft, lessons: split(e.target.value) })} />
                </label>
                <div>
                  <p className="font-medium">{t("brain.retro.decisions")}</p>
                  {draft.decisions.length ? (
                    draft.decisions.map((d, i) => (
                      <label key={i} className="mt-1 flex items-start gap-2">
                        <input type="checkbox" checked={keep.has(i)} onChange={(e) => setKeep((k) => { const n = new Set(k); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                        <span>
                          <span className="font-medium">{d.title}</span>
                          {d.reason && <span className="text-neutral-500"> — {d.reason}</span>}
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="text-neutral-500">—</p>
                  )}
                  {!!draft.decisions.length && <p className="text-[11px] text-neutral-400 mt-1">{t("brain.retro.decisionsHint")}</p>}
                </div>
                <label className="block font-medium">
                  {t("brain.retro.process")} <span className="text-neutral-400 font-normal">({t("brain.retro.onePerLine")})</span>
                  <Textarea className="mt-1" rows={4} value={lines(draft.process)} onChange={(e) => setDraft({ ...draft, process: split(e.target.value) })} />
                </label>
                <label className="block font-medium">
                  {t("brain.retro.note")}
                  <Textarea className="mt-1" rows={3} value={draft.knowledgeNote} onChange={(e) => setDraft({ ...draft, knowledgeNote: e.target.value })} />
                </label>
                <label className="block font-medium">
                  {t("brain.retro.saveTo")}
                  <select value={wikiId} onChange={(e) => setWikiId(e.target.value)} className="mt-1 h-8 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm" data-testid="retro-wiki">
                    {wikis.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  {!wikis.length && <span className="text-amber-600">{t("brain.retro.noWiki")}</span>}
                </label>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={save} disabled={busy || !draft || !wikiId} data-testid="retro-save">
                {t("brain.retro.save")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
