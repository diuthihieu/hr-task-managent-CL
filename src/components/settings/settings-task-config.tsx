"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Star } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CategoryRow, StatusRow } from "@/types";
import { SettingsSection } from "./settings-shell";
import { useT } from "@/components/i18n-provider";

const COLORS = ["#94a3b8", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#6366f1"];

type Row = (StatusRow | CategoryRow) & { category?: StatusRow["category"]; isDefault?: boolean };

/**
 * Statuses and categories are workspace-level rows in PostgreSQL shared by
 * every project. Each edit is saved immediately through the API.
 */
export function SettingsTaskConfig({ workspaceId, mode, canEdit }: { workspaceId: string; mode: "statuses"; canEdit: boolean }) {
  const { t } = useT();
  const STATUS_CATEGORIES = (["todo", "in_progress", "done", "cancelled"] as const).map((v) => ({ value: v, label: t(`st.cat.${v}`) }));
  const base = "statuses";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await api.get<Row[]>(`/api/workspaces/${workspaceId}/${base}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, base, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    load();
  }, [load]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.post(`/api/workspaces/${workspaceId}/${base}`, { name, color: COLORS[rows.length % COLORS.length] });
      setNewName("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function patch(row: Row, body: Record<string, unknown>) {
    try {
      await api.patch(`/api/${base}/${row.id}`, body);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
    }
  }

  async function remove(row: Row) {
    let query = "";
    if (mode === "statuses" && row.taskCount) {
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
      await api.delete(`/api/${base}/${row.id}${query}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <SettingsSection
      title={t("set.statuses")}
      description={t("st.desc")}
    >
      {loading ? (
        <div className="text-sm text-neutral-400">{t("common.loading")}</div>
      ) : (
        <div className="max-w-2xl">
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-100 dark:divide-neutral-900">
            {rows.length === 0 && <div className="px-3 py-4 text-sm text-neutral-400">{t("common.none")}</div>}
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2 px-3 py-2">
                <div className="flex gap-0.5 shrink-0">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      disabled={!canEdit}
                      onClick={() => patch(row, { color: c })}
                      className={cn("h-3.5 w-3.5 rounded-full border", row.color === c ? "border-neutral-900 dark:border-white" : "border-transparent")}
                      style={{ backgroundColor: c }}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
                <Input
                  defaultValue={row.name}
                  disabled={!canEdit}
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== row.name && patch(row, { name: e.target.value.trim() })}
                  className="flex-1 h-7"
                  aria-label="Name"
                />
                {mode === "statuses" && (
                  <>
                    <Select className="w-44 h-7 text-xs" value={row.category ?? "todo"} disabled={!canEdit} onValueChange={(v) => v !== row.category && patch(row, { category: v })} options={STATUS_CATEGORIES} data-testid="status-category" />
                    <button
                      disabled={!canEdit || row.isDefault}
                      onClick={() => patch(row, { isDefault: true })}
                      title={t("st.default")}
                      className={cn("shrink-0", row.isDefault ? "text-amber-500" : "text-neutral-300 hover:text-amber-500")}
                    >
                      <Star size={14} fill={row.isDefault ? "currentColor" : "none"} />
                    </button>
                  </>
                )}
                <span className="text-xs text-neutral-400 w-14 text-right shrink-0">{t("common.tasks", { count: row.taskCount ?? 0 })}</span>
                {canEdit && (
                  <button onClick={() => remove(row)} className="text-neutral-400 hover:text-red-600 shrink-0" aria-label={`Delete ${row.name}`}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {canEdit ? (
            <div className="flex gap-2 mt-3">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder={t("st.new")} className="flex-1" />
              <Button onClick={create} disabled={!newName.trim()}>
                <Plus size={13} /> {t("common.add")}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-neutral-400 mt-3">{t("st.readOnly")}</p>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
