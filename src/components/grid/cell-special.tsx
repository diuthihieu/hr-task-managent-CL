"use client";
// Cells with their own behaviour: links to other tasks, computed (AI / formula) fields and attachment lists.
import { useState } from "react";
import { Link2, Paperclip, Plus, X, RefreshCw, Sparkles } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { parseFieldConfig, type AttachmentValue } from "@/lib/field-types";
import { cn } from "@/lib/utils";
import type { FieldRow } from "@/types";
import { api } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { SearchList } from "@/components/ui/search-list";
import type { LinkTarget } from "./cell-types";

/** Link to other tasks (Parent task, Depends on...): chips, and a searchable list to pick from. */
export function LinkCell({ field, config, value, recordId, target, base, onChange }: { field: FieldRow; config: ReturnType<typeof parseFieldConfig>; value: unknown; recordId: string; target?: LinkTarget; base: string; onChange: (v: unknown) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const values: string[] = Array.isArray(value) ? (value as string[]) : [];
  const labels = values.map((id) => target?.records.find((r) => r.id === id)?.label ?? "…");
  const single = (config as { maxLinks?: number }).maxLinks === 1;
  const items = (target?.records ?? []).filter((r) => r.id !== recordId).map((r) => ({ value: r.id, label: r.label }));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={cn(base, "gap-1 cursor-pointer overflow-hidden")} data-testid={`link-cell-${field.id}`}>
          {labels.length ? (
            labels.map((l, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-xs truncate max-w-[160px]" title={l}>
                <Link2 size={10} className="shrink-0" /> <span className="truncate">{l}</span>
              </span>
            ))
          ) : (
            <span className="text-neutral-300">—</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-1.5 pt-2">
        {!target ? (
          <div className="text-xs text-neutral-400 px-2 py-2">No linked table configured</div>
        ) : (
          <>
            <SearchList
              items={items}
              selected={values}
              placeholder={t("th.searchParent")}
              testId={`link-search-${field.id}`}
              onPick={(id) => {
                if (single) {
                  onChange(values.includes(id) ? [] : [id]);
                  setOpen(false);
                } else onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
              }}
            />
            {single && values.length ? (
              <button type="button" onClick={() => { onChange([]); setOpen(false); }} className="mt-1 w-full rounded-sm px-2 py-1.5 text-left text-xs text-neutral-500 hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800">
                {t("th.removeParent")}
              </button>
            ) : null}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function safeButtonUrl(template: string | undefined, taskId: string): string | null {
  if (!template?.trim()) return null;
  const rendered = template.replaceAll("{taskId}", encodeURIComponent(taskId));
  if (rendered.startsWith("/")) return rendered;
  try {
    const url = new URL(rendered);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function ComputedFieldCell({ field, recordId, initialValue, base }: { field: FieldRow; recordId: string; initialValue: unknown; base: string }) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{ value: unknown }>(`/api/tasks/${recordId}/computed-fields/${field.id}`);
      setValue(result.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  };
  const display = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return (
    <div className={cn(base, "gap-1 overflow-hidden")} title={error || display}>
      {field.type === "ai_field" ? <Sparkles size={12} className="shrink-0 text-violet-500" /> : null}
      <span className={cn("flex-1 truncate", error && "text-red-500")}>{error || display || "—"}</span>
      <button onClick={refresh} disabled={busy} className="shrink-0 text-neutral-400 hover:text-indigo-600 disabled:opacity-50" aria-label="Refresh computed field"><RefreshCw size={12} className={busy ? "animate-spin" : ""} /></button>
    </div>
  );
}

export function AttachmentEditor({ files, onChange }: { files: AttachmentValue[]; onChange: (v: AttachmentValue[]) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  function add() {
    if (!url.trim()) return;
    onChange([...files, { id: `${Date.now()}`, name: name.trim() || url.trim(), url: url.trim() }]);
    setName("");
    setUrl("");
  }

  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-y-auto thin-scroll">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-1.5 text-sm">
              <Paperclip size={12} className="text-neutral-400 shrink-0" />
              <a href={f.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-indigo-600 hover:underline">
                {f.name}
              </a>
              <button onClick={() => onChange(files.filter((x) => x.id !== f.id))} className="text-neutral-400 hover:text-red-600 shrink-0">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1.5 pt-1 border-t border-neutral-100 dark:border-neutral-800">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="File name (optional)" className="h-7" />
        <div className="flex gap-1.5">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-7 flex-1" onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button size="icon" onClick={add} disabled={!url.trim()}>
            <Plus size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
}
