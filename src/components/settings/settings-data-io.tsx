"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ExportDialog } from "@/components/views/export-dialog";
import { parseFieldConfig, SELECT_SINGLE_TYPES } from "@/lib/field-types";
import type { FieldRow, RecordRow } from "@/types";
import { SettingsSection } from "./settings-shell";

interface MasterTable {
  baseId: string;
  tableId: string;
  tableName: string;
  fields: FieldRow[];
}
interface MemberLite {
  id: string;
  name: string;
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
  const [table, setTable] = useState<MasterTable | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<MasterTable>(`/api/workspaces/${workspaceId}/master-table`).then((t) => {
      setTable(t);
      api.get<RecordRow[]>(`/api/tables/${t.tableId}/records`).then(setRecords);
    });
    api.get<MemberLite[]>(`/api/workspaces/${workspaceId}/members`).then(setMembers);
  }, [workspaceId]);

  async function handleImport(file: File) {
    if (!table) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) {
      toast.error("CSV has no data rows");
      return;
    }
    const [header, ...dataRows] = rows;
    const fieldByHeader = header.map((h) => table.fields.find((f) => f.name.toLowerCase() === h.trim().toLowerCase()) ?? null);
    if (fieldByHeader.every((f) => !f)) {
      toast.error("No CSV column matched a field on this table by name");
      return;
    }
    const capped = dataRows.slice(0, 500);
    setImporting(true);
    let created = 0;
    try {
      for (const row of capped) {
        const data: Record<string, unknown> = {};
        row.forEach((cell, i) => {
          const field = fieldByHeader[i];
          if (!field || !cell.trim()) return;
          if (SELECT_SINGLE_TYPES.includes(field.type)) {
            const options = parseFieldConfig(field.config).options ?? [];
            const match = options.find((o) => o.label.toLowerCase() === cell.trim().toLowerCase());
            if (match) data[field.id] = match.id;
          } else if (["number", "integer", "percent", "currency"].includes(field.type)) {
            const n = Number(cell);
            if (!Number.isNaN(n)) data[field.id] = n;
          } else if (field.type === "checkbox") {
            data[field.id] = ["true", "yes", "1"].includes(cell.trim().toLowerCase());
          } else {
            data[field.id] = cell;
          }
        });
        const record = await api.post<RecordRow>(`/api/tables/${table.tableId}/records`, { data });
        created++;
        setRecords((prev) => [...prev, record]);
      }
      toast.success(`Imported ${created} record${created === 1 ? "" : "s"}${dataRows.length > 500 ? " (capped at 500 per import)" : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Import failed after ${created} record(s)`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!table) return <div className="p-6 text-sm text-neutral-400">Loading…</div>;

  return (
    <SettingsSection title="Import / Export" description={`Bring data into ${table.tableName} or take a copy out.`}>
      <div className="space-y-4 max-w-lg">
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
          <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100 mb-1">Export</div>
          <p className="text-xs text-neutral-400 mb-2">Download all records from {table.tableName} as CSV or Excel.</p>
          <Button size="sm" variant="secondary" onClick={() => setExportOpen(true)}>
            <Download size={13} /> Export {table.tableName}
          </Button>
        </div>

        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
          <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100 mb-1">Import</div>
          <p className="text-xs text-neutral-400 mb-2">
            Upload a CSV file. Columns are matched to fields on {table.tableName} by name (case-insensitive); unmatched columns are ignored.
          </p>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])} />
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
            <Upload size={13} /> {importing ? "Importing…" : "Import CSV"}
          </Button>
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
