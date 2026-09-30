"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Star, Info, AlertTriangle, CircleDashed, Loader, CheckCircle2, Ban } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ColorPicker, COLOR_PALETTE as COLORS } from "@/components/ui/color-picker";
import { cn } from "@/lib/utils";
import type { StatusRow } from "@/types";
import type { MessageKey } from "@/lib/i18n/core";
import { SettingsSection } from "./settings-shell";
import { useT } from "@/components/i18n-provider";

const CATEGORIES = ["todo", "in_progress", "done", "cancelled"] as const;
type Category = (typeof CATEGORIES)[number];
const CAT_ICON = { todo: CircleDashed, in_progress: Loader, done: CheckCircle2, cancelled: Ban } as const;

type Row = StatusRow & { category: Category; isDefault?: boolean; taskCount?: number };

/**
 * Workspace statuses, shared by every project. Each edit is saved at once.
 * The page explains what each setting drives and flags setups that would
 * miscount work (e.g. new tasks landing in a "done" status).
 */
export function SettingsTaskConfig({ workspaceId, canEdit }: { workspaceId: string; mode?: "statuses"; canEdit: boolean }) {
  const { t } = useT();
  const categoryOptions = CATEGORIES.map((v) => ({ value: v, label: t(`st.cat.${v}` as MessageKey) }));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<Category>("in_progress");
  const [guide, setGuide] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<Row[]>(`/api/workspaces/${workspaceId}/statuses`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.post(`/api/workspaces/${workspaceId}/statuses`, { name, color: COLORS[(rows.length * 3) % COLORS.length], category: newCategory });
      setNewName("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function patch(row: Row, body: Record<string, unknown>) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...body } : body.isDefault ? { ...r, isDefault: false } : r)));
    try {
      await api.patch(`/api/statuses/${row.id}`, body);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
    }
  }

  function changeCategory(row: Row, category: Category) {
    if (category === row.category) return;
    // Moving a status in or out of "done" re-counts every task in it: say so first.
    if ((row.taskCount ?? 0) > 0 && !confirm(t("st.categoryConfirm", { name: row.name, count: row.taskCount ?? 0, from: t(`st.catShort.${row.category}` as MessageKey), to: t(`st.catShort.${category}` as MessageKey) }))) return;
    patch(row, { category });
  }

  async function remove(row: Row) {
    let query = "";
    if (row.taskCount) {
      const others = rows.filter((r) => r.id !== row.id);
      const target = prompt(`${t("st.moveTasks", { count: row.taskCount, name: row.name })}\n${others.map((o) => o.name).join(", ")}`);
      if (!target) return;
      const match = others.find((o) => o.name.toLowerCase() === target.trim().toLowerCase());
      if (!match) {
        toast.error(t("st.noSuchStatus"));
        return;
      }
      query = `?reassignTo=${match.id}`;
    } else if (!confirm(t("common.confirmDelete", { name: row.name }))) {
      return;
    }
    try {
      await api.delete(`/api/statuses/${row.id}${query}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  // Setups that would miscount work.
  const warnings = useMemo(() => {
    const out: string[] = [];
    const def = rows.find((r) => r.isDefault);
    if (def && (def.category === "done" || def.category === "cancelled")) out.push(t("st.warn.defaultClosed", { name: def.name, cat: t(`st.catShort.${def.category}` as MessageKey) }));
    if (rows.length && !rows.some((r) => r.category === "done")) out.push(t("st.warn.noDone"));
    if (rows.length && !rows.some((r) => r.category === "todo" || r.category === "in_progress")) out.push(t("st.warn.noOpen"));
    for (const r of rows) {
      if (r.category === "done" && /to ?do|chưa|cần làm|backlog|new|mới|block|chờ|pending/i.test(r.name)) out.push(t("st.warn.nameMismatch", { name: r.name }));
    }
    return out;
  }, [rows, t]);

  return (
    <SettingsSection title={t("set.statuses")} description={t("st.desc")}>
      {loading ? (
        <div className="text-sm text-neutral-400">{t("common.loading")}</div>
      ) : (
        <div className="max-w-3xl space-y-4">
          <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 text-sm" data-testid="status-guide">
            <button onClick={() => setGuide(!guide)} className="w-full text-left font-semibold text-neutral-800 dark:text-neutral-100 flex items-center gap-1.5">
              <Info size={15} className="text-indigo-600" /> {t("st.guide.title")}
              <span className="ml-auto text-xs font-normal text-indigo-600">{guide ? t("st.guide.hide") : t("st.guide.show")}</span>
            </button>
            {guide && (
            <>
            <ol className="mt-3 space-y-2 text-neutral-600 dark:text-neutral-300 list-decimal pl-5">
              <li>{t("st.guide.name")}</li>
              <li>{t("st.guide.color")}</li>
              <li>
                {t("st.guide.category")}
                <ul className="mt-1.5 grid sm:grid-cols-2 gap-1.5">
                  {CATEGORIES.map((c) => {
                    const Icon = CAT_ICON[c];
                    return (
                      <li key={c} className="flex gap-2 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5 text-xs">
                        <Icon size={13} className="text-indigo-600 shrink-0 mt-0.5" />
                        <span>
                          <b className="text-neutral-800 dark:text-neutral-100">{t(`st.catShort.${c}` as MessageKey)}</b>: {t(`st.catHelp.${c}` as MessageKey)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
              <li>{t("st.guide.default")}</li>
              <li>{t("st.guide.delete")}</li>
            </ol>
            <p className="mt-2 text-xs text-neutral-500">{t("st.guide.example")}</p>
            </>
            )}
          </div>

          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200 space-y-1" data-testid="status-warnings">
              {warnings.map((w) => (
                <div key={w} className="flex gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-white dark:bg-neutral-900">
            <div className="hidden sm:grid grid-cols-[44px_1fr_220px_44px_80px_32px] gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 border-b border-neutral-100 dark:border-neutral-800">
              <span>{t("st.col.color")}</span>
              <span>{t("st.col.name")}</span>
              <span>{t("st.col.category")}</span>
              <span className="text-center">{t("st.col.default")}</span>
              <span className="text-right">{t("st.col.tasks")}</span>
              <span />
            </div>
            {rows.length === 0 && <div className="px-3 py-4 text-sm text-neutral-400">{t("common.none")}</div>}
            {rows.map((row) => (
              <div key={row.id} className="grid grid-cols-[44px_1fr_32px] sm:grid-cols-[44px_1fr_220px_44px_80px_32px] items-center gap-2 px-3 py-2 border-b last:border-0 border-neutral-100 dark:border-neutral-800" data-testid="status-row">
                <ColorPicker color={row.color} disabled={!canEdit} onPick={(c) => patch(row, { color: c })} label={t("st.pickColor", { name: row.name })} testId="status-color" />
                <Input
                  key={row.name}
                  defaultValue={row.name}
                  disabled={!canEdit}
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== row.name && patch(row, { name: e.target.value.trim() })}
                  className="h-8"
                  aria-label={t("st.col.name")}
                />
                <span className="sm:hidden" />
                <div className="col-span-3 sm:col-span-1 flex items-center gap-2 sm:block">
                  <Select className="w-full h-8 text-xs" value={row.category ?? "todo"} disabled={!canEdit} onValueChange={(v) => changeCategory(row, v as Category)} options={categoryOptions} data-testid="status-category" />
                </div>
                <button
                  disabled={!canEdit || row.isDefault}
                  onClick={() => patch(row, { isDefault: true })}
                  title={row.isDefault ? t("st.isDefault") : t("st.makeDefault")}
                  className={cn("hidden sm:flex justify-center", row.isDefault ? "text-amber-500" : "text-neutral-300 hover:text-amber-500 disabled:hover:text-neutral-300")}
                  data-testid="status-default"
                >
                  <Star size={15} fill={row.isDefault ? "currentColor" : "none"} />
                </button>
                <span className="hidden sm:block text-xs text-neutral-400 text-right">{t("common.tasks", { count: row.taskCount ?? 0 })}</span>
                {canEdit ? (
                  <button onClick={() => remove(row)} className="hidden sm:flex justify-center text-neutral-400 hover:text-red-600" aria-label={`${t("common.delete")} ${row.name}`}>
                    <Trash2 size={14} />
                  </button>
                ) : (
                  <span className="hidden sm:block" />
                )}
              </div>
            ))}
          </div>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder={t("st.new")} className="flex-1 min-w-48" />
              <Select className="w-56" value={newCategory} onValueChange={(v) => setNewCategory(v as Category)} options={categoryOptions} />
              <Button onClick={create} disabled={!newName.trim()}>
                <Plus size={13} /> {t("common.add")}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-neutral-400">{t("st.readOnly")}</p>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
