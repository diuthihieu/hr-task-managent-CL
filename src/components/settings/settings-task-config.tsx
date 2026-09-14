"use client";
import { useEffect, useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";
import { nanoid } from "nanoid";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { getFieldType } from "@/lib/field-types";
import { detectCaptureFieldRoles } from "@/lib/capture-engine";
import type { FieldRow } from "@/types";
import { SettingsSection } from "./settings-shell";

const OPTION_COLORS = ["#94a3b8", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#8b5cf6", "#ec4899"];

interface MasterTable {
  baseId: string;
  baseName: string;
  tableId: string;
  tableName: string;
  fields: FieldRow[];
}

export function SettingsTaskConfig({ workspaceId, mode }: { workspaceId: string; mode: "statuses" | "categories" | "fields" }) {
  const [table, setTable] = useState<MasterTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .get<MasterTable>(`/api/workspaces/${workspaceId}/master-table`)
      .then(setTable)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  if (loading) return <div className="p-6 text-sm text-neutral-400">Loading…</div>;
  if (error || !table) return <div className="p-6 text-sm text-neutral-400">No task base found yet - create one first.</div>;

  const roles = detectCaptureFieldRoles(table.fields);

  function patchField(fieldId: string, next: FieldRow) {
    setTable((t) => (t ? { ...t, fields: t.fields.map((f) => (f.id === fieldId ? next : f)) } : t));
  }

  if (mode === "statuses") {
    return (
      <SettingsSection title="Task Statuses & Priorities" description={`Editing the Status and Priority options used across ${table.tableName}. Changes apply everywhere - Grid, Kanban, filters and dashboards.`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl">
          {roles.statusField ? (
            <OptionsEditor field={roles.statusField} onSaved={(f) => patchField(f.id, f)} />
          ) : (
            <p className="text-sm text-neutral-400">No Status field found on {table.tableName}.</p>
          )}
          {roles.priorityField ? (
            <OptionsEditor field={roles.priorityField} onSaved={(f) => patchField(f.id, f)} />
          ) : (
            <p className="text-sm text-neutral-400">No Priority field found on {table.tableName}.</p>
          )}
        </div>
      </SettingsSection>
    );
  }

  if (mode === "categories") {
    return (
      <SettingsSection title="Categories" description={`Editing the Category options used across ${table.tableName}. Every saved view filtered by category reads these live.`}>
        <div className="max-w-md">
          {roles.categoryField ? (
            <OptionsEditor field={roles.categoryField} onSaved={(f) => patchField(f.id, f)} />
          ) : (
            <p className="text-sm text-neutral-400">No Category field found on {table.tableName}.</p>
          )}
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Default Fields" description={`Every field defined on ${table.tableName}, the workspace's master task table. Toggle visibility to hide a field from the Grid by default.`}>
      <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-100 dark:divide-neutral-900 max-w-2xl">
        {table.fields.map((f) => (
          <div key={f.id} className="flex items-center gap-3 px-3 py-2">
            <span className="flex-1 min-w-0 truncate text-sm text-neutral-800 dark:text-neutral-100">
              {f.name}
              {f.isPrimary && <span className="ml-2 text-[10px] text-indigo-500 font-medium uppercase tracking-wide">Primary</span>}
            </span>
            <span className="text-xs text-neutral-400 shrink-0">{getFieldType(f.type).label}</span>
            <Switch
              checked={f.visible}
              onCheckedChange={async (v) => {
                patchField(f.id, { ...f, visible: v });
                try {
                  await api.patch(`/api/fields/${f.id}`, { visible: v });
                } catch {
                  toast.error("Failed to update field visibility");
                  patchField(f.id, f);
                }
              }}
            />
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

function OptionsEditor({ field, onSaved }: { field: FieldRow; onSaved: (field: FieldRow) => void }) {
  const initialOptions = (JSON.parse(field.config || "{}").options ?? []) as { id: string; label: string; color: string }[];
  const [options, setOptions] = useState(initialOptions);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  function update(id: string, patch: Partial<{ label: string; color: string }>) {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    setDirty(true);
  }
  function add() {
    setOptions((prev) => [...prev, { id: nanoid(6), label: "New option", color: OPTION_COLORS[prev.length % OPTION_COLORS.length] }]);
    setDirty(true);
  }
  function remove(id: string) {
    setOptions((prev) => prev.filter((o) => o.id !== id));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await api.patch<FieldRow>(`/api/fields/${field.id}`, { config: { options } });
      onSaved(updated);
      setDirty(false);
      toast.success(`${field.name} options saved`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save options");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <label className="text-xs font-medium text-neutral-500 mb-1.5 block">{field.name}</label>
      <div className="space-y-1.5 max-h-64 overflow-y-auto thin-scroll">
        {options.map((o) => (
          <div key={o.id} className="flex items-center gap-1.5">
            <GripVertical size={12} className="text-neutral-300 shrink-0" />
            <div className="flex gap-1 shrink-0">
              {OPTION_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => update(o.id, { color: c })}
                  className="h-4 w-4 rounded-full border"
                  style={{ backgroundColor: c, borderColor: o.color === c ? "#000" : "transparent" }}
                />
              ))}
            </div>
            <Input value={o.label} onChange={(e) => update(o.id, { label: e.target.value })} className="flex-1 h-7" />
            <button onClick={() => remove(o.id)} className="text-neutral-400 hover:text-red-600 shrink-0">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button onClick={add} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline">
          <Plus size={12} /> Add option
        </button>
        {dirty && (
          <button onClick={save} disabled={saving} className="text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-md px-2 py-1 disabled:opacity-50">
            Save changes
          </button>
        )}
      </div>
    </div>
  );
}
