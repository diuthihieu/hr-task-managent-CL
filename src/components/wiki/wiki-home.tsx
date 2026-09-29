"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Plus, Lock, Globe2, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";
import type { WikiRow } from "@/lib/wiki";

/** Wiki landing: every wiki the user can open, and "New wiki". */
export function WikiHome({ workspaceId, workspaceSlug, wikis, canCreate }: { workspaceId: string; workspaceSlug: string; wikis: WikiRow[]; canCreate: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className="max-w-[68.75rem] mx-auto px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-neutral-900 dark:text-neutral-50">{t("nav.wiki")}</h1>
            <p className="text-sm text-neutral-500 mt-0.5">{t("wikis.subtitle")}</p>
          </div>
          {canCreate && (
            <Button onClick={() => setOpen(true)} data-testid="wiki-create">
              <Plus size={14} /> {t("wikis.new")}
            </Button>
          )}
        </div>
        {wikis.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-10 text-center">
            <BookOpen size={32} className="mx-auto text-indigo-500 mb-3" />
            <h2 className="font-semibold">{t("wikis.emptyTitle")}</h2>
            <p className="text-sm text-neutral-500 mt-1">{t("wikis.emptyBody")}</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {wikis.map((w) => (
              <Link key={w.id} href={`/w/${workspaceSlug}/wiki/${w.id}`} className="group rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 hover:border-indigo-200 dark:hover:border-indigo-900 transition-colors" data-testid="wiki-card">
                <div className="flex items-center gap-2.5">
                  <span className="h-10 w-10 rounded-xl flex items-center justify-center text-lg shrink-0 font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                    {w.icon || <BookOpen size={18} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold truncate text-neutral-900 dark:text-neutral-100">{w.name}</span>
                    <span className="flex items-center gap-1 text-[11px] text-neutral-500">
                      {w.access === "restricted" ? <Lock size={10} /> : <Globe2 size={10} />}
                      {t(`wikis.access.${w.access}` as MessageKey)} · {t(`wikis.role.${w.myRole ?? "viewer"}` as MessageKey)}
                    </span>
                  </span>
                </div>
                {w.description && <p className="text-sm text-neutral-500 mt-3 line-clamp-2">{w.description}</p>}
                <div className="flex items-center gap-3 mt-3 text-xs text-neutral-400">
                  <span className="inline-flex items-center gap-1"><FileText size={11} /> {t("wikis.pages", { count: w.pageCount })}</span>
                  <span className="ml-auto">{formatDate(w.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {open && <NewWikiDialog workspaceId={workspaceId} workspaceSlug={workspaceSlug} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function NewWikiDialog({ workspaceId, workspaceSlug, onClose }: { workspaceId: string; workspaceSlug: string; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [access, setAccess] = useState<"workspace" | "restricted">("workspace");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const w = await api.post<WikiRow>(`/api/workspaces/${workspaceId}/wikis`, { name: name.trim(), description: description.trim() || null, access });
      router.push(`/w/${workspaceSlug}/wiki/${w.id}`);
      router.refresh();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogTitle>{t("wikis.new")}</DialogTitle>
        <div className="space-y-3">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("wikis.namePh")} maxLength={160} onKeyDown={(e) => e.key === "Enter" && name.trim() && create()} data-testid="wiki-new-name" />
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("wikis.description")} />
          <div className="grid grid-cols-2 gap-2">
            {(["workspace", "restricted"] as const).map((a) => (
              <button key={a} onClick={() => setAccess(a)} className={cn("text-left rounded-lg border p-2.5 text-sm", access === a ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40" : "border-neutral-200 dark:border-neutral-800")} data-testid={`wiki-new-access-${a}`}>
                <span className="flex items-center gap-1.5 font-medium">{a === "workspace" ? <Globe2 size={14} /> : <Lock size={14} />} {t(`wikis.access.${a}` as MessageKey)}</span>
                <span className="block text-[11px] text-neutral-500 mt-0.5">{t(`wikis.access.${a}.hint` as MessageKey)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={create} disabled={busy || !name.trim()} data-testid="wiki-new-submit">{t("common.create")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
