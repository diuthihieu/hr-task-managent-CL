"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Upload, FileSpreadsheet } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ExportDialog } from "@/components/views/export-dialog";
import { parseFieldConfig, SELECT_SINGLE_TYPES } from "@/lib/field-types";
import type { FieldRow, RecordRow } from "@/types";
import { SettingsSection } from "./settings-shell";
import { useProjectPicker } from "./project-picker";
import { useT } from "@/components/i18n-provider";

interface MemberLite {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function SettingsDataIO({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const { projects, projectId, project, picker } = useProjectPicker(workspaceId);
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<MemberLite[]>(`/api/workspaces/${workspaceId}/members`).then(setMembers).catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    if (!projectId) return;
    api.get<{ fields: FieldRow[] }>(`/api/projects/${projectId}`).then((d) => setFields(d.fields)).catch(() => {});
    api.get<RecordRow[]>(`/api/projects/${projectId}/tasks`).then(setRecords).catch(() => {});
  }, [projectId]);

  function cellToValue(field: FieldRow, raw: string): unknown {
    const cell = raw.trim();
    if (!cell) return undefined;
    const options = parseFieldConfig(field.config).options ?? [];
    if ([...SELECT_SINGLE_TYPES, "single_select"].includes(field.type)) return options.find((o) => o.label.toLowerCase() === cell.toLowerCase())?.id;
    if (field.type === "multi_select") return cell.split(/[;,]/).map((p) => options.find((o) => o.label.toLowerCase() === p.trim().toLowerCase())?.id).filter(Boolean);
    if (field.type === "person" || field.type === "people") {
      const ids = cell.split(/[;,]/).map((p) => members.find((m) => m.email.toLowerCase() === p.trim().toLowerCase() || m.name.toLowerCase() === p.trim().toLowerCase())?.id).filter(Boolean);
      return field.type === "person" ? ids[0] : ids;
    }
    if (["number", "percent", "currency", "rating", "progress"].includes(field.type)) {
      const n = Number(cell.replace(/[^0-9.-]/g, ""));
      return Number.isNaN(n) ? undefined : n;
    }
    if (field.type === "checkbox") return ["true", "yes", "1", "x"].includes(cell.toLowerCase());
    if (field.type === "date") {
      const d = new Date(cell);
      return Number.isNaN(d.getTime()) ? undefined : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
    }
    return cell;
  }

  /** Rows of the uploaded file: CSV, or the "Tasks" (else first) sheet of an Excel workbook. */
  async function readRows(file: File): Promise<string[][]> {
    if (!/\.(xlsx|xls)$/i.test(file.name)) return parseCsv(await file.text());
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const name = wb.SheetNames.find((n) => n.toLowerCase() === "tasks") ?? wb.SheetNames[0];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" }) as unknown[][];
    return raw
      .map((row) => row.map((c) => (c instanceof Date ? new Date(c.getTime() - c.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(c ?? ""))))
      .filter((row) => row.some((c) => c.trim() !== ""));
  }

  /** Two-sheet Excel template: "Tasks" to fill in, and an instructions sheet describing every column. */
  async function downloadTemplate() {
    if (!project) return;
    const XLSX = await import("xlsx");
    const writable = fields.filter((f) => !f.readOnly && f.type !== "formula" && f.type !== "link" && f.type !== "attachment");
    const today = new Date();
    const iso = (days: number) => new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
    const sample = (f: FieldRow, i: number): string | number => {
      const opts = parseFieldConfig(f.config).options ?? [];
      if (f.isPrimary) return i === 0 ? t("io.tpl.sample1") : t("io.tpl.sample2");
      if (opts.length) return opts[Math.min(i, opts.length - 1)].label;
      if (f.type === "person" || f.type === "people") return members[0]?.email ?? "name@company.com";
      if (f.type === "date" || f.type === "datetime") return iso(i === 0 ? 7 : 14);
      if (f.type === "checkbox") return i === 0 ? "yes" : "no";
      if (f.type === "progress" || f.type === "percent") return i === 0 ? 0 : 50;
      if (["number", "currency", "rating", "integer"].includes(f.type)) return i === 0 ? 4 : 8;
      return "";
    };
    const describe = (f: FieldRow) => {
      const opts = parseFieldConfig(f.config).options ?? [];
      if (opts.length) return t("io.tpl.oneOf", { values: opts.map((o) => o.label).join(" | ") }) + (f.type === "multi_select" ? ` ${t("io.tpl.multi")}` : "");
      if (f.type === "person" || f.type === "people") return t("io.tpl.person");
      if (f.type === "date" || f.type === "datetime") return t("io.tpl.date");
      if (f.type === "checkbox") return t("io.tpl.checkbox");
      if (f.type === "progress" || f.type === "percent") return t("io.tpl.percent");
      if (["number", "currency", "rating", "integer"].includes(f.type)) return t("io.tpl.number");
      return t("io.tpl.text");
    };
    const tasks = XLSX.utils.aoa_to_sheet([writable.map((f) => f.name), ...[0, 1].map((i) => writable.map((f) => sample(f, i)))]);
    tasks["!cols"] = writable.map((f) => ({ wch: Math.max(14, Math.min(40, f.name.length + 4)) }));
    const guide = XLSX.utils.aoa_to_sheet([
      [t("io.tpl.title", { project: project.name })],
      [t("io.tpl.how1")],
      [t("io.tpl.how2")],
      [t("io.tpl.how3")],
      [t("io.tpl.how4")],
      [],
      [t("io.tpl.col.column"), t("io.tpl.col.required"), t("io.tpl.col.format"), t("io.tpl.col.example"), t("io.tpl.col.notes")],
      ...writable.map((f) => [f.name, f.isPrimary ? t("io.tpl.yes") : t("io.tpl.no"), describe(f), String(sample(f, 0)), f.description ?? ""]),
      [],
      [t("io.tpl.members")],
      ...members.map((m) => [m.name, m.email]),
    ]);
    guide["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 60 }, { wch: 28 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, tasks, "Tasks");
    XLSX.utils.book_append_sheet(wb, guide, t("io.tpl.sheet").slice(0, 31));
    XLSX.writeFile(wb, `${project.name.replace(/[\\/:*?"<>|]/g, "_")}-import-template.xlsx`);
  }

  async function handleImport(file: File) {
    if (!projectId) return;
    const rows = await readRows(file);
    if (rows.length < 2) {
      toast.error(t("io.noRows"));
      return;
    }
    const [header, ...dataRows] = rows;
    const writable = fields.filter((f) => !f.readOnly && f.type !== "formula" && f.type !== "link");
    const fieldByHeader = header.map((h) => writable.find((f) => f.name.toLowerCase() === h.trim().toLowerCase()) ?? null);
    if (fieldByHeader.every((f) => !f)) {
      toast.error(t("io.noMatch"));
      return;
    }
    if (dataRows.length > 1000) {
      toast.error(t("io.tooMany"));
      return;
    }
    const payload = dataRows
      .filter((row) => row.some((c) => c.trim()))
      .map((row) => {
        const data: Record<string, unknown> = {};
        row.forEach((cell, i) => {
          const field = fieldByHeader[i];
          if (!field) return;
          const v = cellToValue(field, cell);
          if (v !== undefined) data[field.id] = v;
        });
        return data;
      });
    setImporting(true);
    try {
      const res = await api.post<{ created: number }>(`/api/projects/${projectId}/tasks/import`, { rows: payload });
      toast.success(t("io.imported", { count: res.created }));
      setRecords(await api.get<RecordRow[]>(`/api/projects/${projectId}/tasks`));
    } catch (e) {
      toast.error(e instanceof Error ? t("io.nothing", { error: e.message }) : t("common.failed"));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!projects) return <div className="p-6 text-sm text-neutral-400">{t("common.loading")}</div>;
  if (!project) return <div className="p-6 text-sm text-neutral-400">{t("sv.noProjects")}</div>;
  const table = { tableName: project.name, fields };


  return (
    <SettingsSection title={t("set.dataIo")} description={t("io.desc", { project: table.tableName })}>
      {picker}
      <div className="space-y-4 max-w-lg">
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
          <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100 mb-1">{t("io.export")}</div>
          <p className="text-xs text-neutral-400 mb-2">{t("io.exportDesc", { project: table.tableName })}</p>
          <Button size="sm" variant="secondary" onClick={() => setExportOpen(true)}>
            <Download size={13} /> {t("io.exportBtn", { project: table.tableName })}
          </Button>
        </div>

        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
          <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100 mb-1">{t("io.import")}</div>
          <p className="text-xs text-neutral-400 mb-2">
            {t("io.importDesc")}
          </p>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])} data-testid="io-import-input" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={downloadTemplate} disabled={!fields.length} data-testid="io-template">
              <FileSpreadsheet size={13} /> {t("io.templateBtn")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
              <Upload size={13} /> {importing ? t("io.importing") : t("io.importBtn")}
            </Button>
          </div>
          <p className="text-[11px] text-neutral-400 mt-2">{t("io.templateHint")}</p>
        </div>
      </div>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        tableName={table.tableName}
        allFields={table.fields}
        visibleFields={table.fields.filter((f) => f.visible)}
        allRecords={records}
        filteredRecords={records}
        selectedRecords={[]}
        members={members}
      />
    </SettingsSection>
  );
}
