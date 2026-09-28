"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, File as FileIcon, Loader2, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";

export interface ViewableFile {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes?: number;
}

type Kind = "image" | "pdf" | "video" | "audio" | "text" | "sheet" | "docx" | "pptx" | "none";

const TEXT_EXT = /\.(txt|md|csv|tsv|json|log|xml|ya?ml)$/i;
const SHEET_EXT = /\.(xlsx|xls|ods)$/i;
/** Text/sheet previews are parsed in the browser; skip anything too big to parse comfortably. */
const MAX_PARSE_BYTES = 5 * 1024 * 1024;

export function previewKind(f: { fileName: string; contentType: string }): Kind {
  const ct = f.contentType.toLowerCase();
  if (/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(ct)) return "image";
  if (ct === "application/pdf") return "pdf";
  if (/^video\/(mp4|webm|ogg|quicktime)$/.test(ct)) return "video";
  if (/^audio\//.test(ct)) return "audio";
  if (/\.docx$/i.test(f.fileName) || ct === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (/\.pptx$/i.test(f.fileName) || ct === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (SHEET_EXT.test(f.fileName) || ct.includes("spreadsheet") || ct === "application/vnd.ms-excel") return "sheet";
  if (ct.startsWith("text/") || ct === "application/json" || TEXT_EXT.test(f.fileName)) return "text";
  return "none";
}

const downloadUrl = (id: string) => `/api/attachments/${id}/download`;
const inlineUrl = (id: string) => `/api/attachments/${id}/download?inline=1`;

function formatBytes(n?: number) {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * In-app file viewer: images, PDF, audio/video, text/CSV and spreadsheets are
 * previewed in place; every file can be downloaded. Arrow keys switch files.
 */
export function AttachmentViewer({ files, index, onIndexChange, onClose }: { files: ViewableFile[]; index: number; onIndexChange: (i: number) => void; onClose: () => void }) {
  const { t } = useT();
  const file = files[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && index < files.length - 1) onIndexChange(index + 1);
      else if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, files.length, onClose, onIndexChange]);

  if (!file) return null;
  const kind = previewKind(file);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/85" role="dialog" aria-label={file.fileName} data-testid="attachment-viewer">
      <div className="flex items-center gap-2 h-12 px-3 text-white shrink-0">
        <FileIcon size={15} className="opacity-70 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate" data-testid="viewer-filename">{file.fileName}</div>
          <div className="text-[11px] text-white/60">
            {formatBytes(file.sizeBytes)}
            {files.length > 1 && ` · ${index + 1}/${files.length}`}
          </div>
        </div>
        {kind !== "none" && kind !== "docx" && kind !== "pptx" && (
          <a href={inlineUrl(file.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 h-8 text-xs hover:bg-white/10" title={t("att.openNewTab")}>
            <ExternalLink size={14} /> <span className="hidden sm:inline">{t("att.openNewTab")}</span>
          </a>
        )}
        <a href={downloadUrl(file.id)} className="inline-flex items-center gap-1 rounded-md px-2.5 h-8 text-xs bg-white/15 hover:bg-white/25" data-testid="viewer-download">
          <Download size={14} /> {t("att.download")}
        </a>
        <button onClick={onClose} className="rounded-md p-1.5 hover:bg-white/10" aria-label={t("common.close")} data-testid="viewer-close">
          <X size={18} />
        </button>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-12 pb-6" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {index > 0 && (
          <button onClick={() => onIndexChange(index - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-white bg-white/10 hover:bg-white/20" aria-label={t("att.prev")}>
            <ChevronLeft size={20} />
          </button>
        )}
        <Preview key={file.id} file={file} kind={kind} />
        {index < files.length - 1 && (
          <button onClick={() => onIndexChange(index + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-white bg-white/10 hover:bg-white/20" aria-label={t("att.next")}>
            <ChevronRight size={20} />
          </button>
        )}
      </div>
    </div>
  );
}

function Preview({ file, kind }: { file: ViewableFile; kind: Kind }) {
  const { t } = useT();
  if (kind === "image")
    // eslint-disable-next-line @next/next/no-img-element -- authorized, private attachment route
    return <img src={inlineUrl(file.id)} alt={file.fileName} className="max-h-full max-w-full object-contain rounded shadow-2xl" data-testid="viewer-image" />;
  if (kind === "pdf") return <iframe src={inlineUrl(file.id)} title={file.fileName} className="h-full w-full max-w-5xl rounded bg-white" data-testid="viewer-pdf" />;
  if (kind === "video") return <video src={inlineUrl(file.id)} controls autoPlay className="max-h-full max-w-full rounded" data-testid="viewer-video" />;
  if (kind === "audio") return <audio src={inlineUrl(file.id)} controls autoPlay className="w-full max-w-lg" data-testid="viewer-audio" />;
  if ((kind === "text" || kind === "sheet") && (file.sizeBytes ?? 0) <= MAX_PARSE_BYTES) return <ParsedPreview file={file} kind={kind} />;
  if (kind === "docx" || kind === "pptx") return <OfficePreview file={file} kind={kind} />;
  return (
    <div className="rounded-xl bg-white dark:bg-neutral-900 p-8 text-center max-w-sm" data-testid="viewer-no-preview">
      <FileIcon size={40} className="mx-auto text-neutral-400 mb-3" />
      <p className="text-sm text-neutral-700 dark:text-neutral-200 font-medium">{t("att.noPreview")}</p>
      <p className="text-xs text-neutral-500 mt-1">{t("att.noPreviewHint")}</p>
      <a href={downloadUrl(file.id)} className="inline-block mt-4">
        <Button>
          <Download size={14} /> {t("att.download")}
        </Button>
      </a>
    </div>
  );
}

/** Text and spreadsheet files are fetched and rendered as plain text / tables (never as HTML). */
function ParsedPreview({ file, kind }: { file: ViewableFile; kind: "text" | "sheet" }) {
  const { t } = useT();
  const [text, setText] = useState<string | null>(null);
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(downloadUrl(file.id));
        if (!res.ok) throw new Error(String(res.status));
        const isCsv = /\.(csv|tsv)$/i.test(file.fileName) || file.contentType === "text/csv";
        if (kind === "sheet" || isCsv) {
          const XLSX = await import("xlsx");
          const wb = isCsv ? XLSX.read(await res.text(), { type: "string" }) : XLSX.read(await res.arrayBuffer(), { type: "array" });
          const parsed = wb.SheetNames.slice(0, 20).map((name) => ({
            name,
            rows: (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" }) as unknown[][]).slice(0, 500).map((r) => r.slice(0, 50).map((c) => String(c ?? ""))),
          }));
          if (!cancelled) setSheets(parsed);
        } else {
          const body = await res.text();
          if (!cancelled) setText(body.slice(0, 200_000));
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.id, file.fileName, file.contentType, kind]);

  if (error) return <p className="text-sm text-white/80">{t("att.previewFailed")}</p>;
  if (text === null && sheets === null) return <Loader2 size={24} className="animate-spin text-white/70" />;
  if (text !== null)
    return (
      <pre className="h-full w-full max-w-5xl overflow-auto thin-scroll rounded bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 p-4 text-xs whitespace-pre-wrap" data-testid="viewer-text">
        {text}
      </pre>
    );
  const sheet = sheets![active];
  return (
    <div className="h-full w-full max-w-6xl flex flex-col rounded bg-white dark:bg-neutral-900 overflow-hidden" data-testid="viewer-sheet">
      {sheets!.length > 1 && (
        <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800 px-2 py-1 overflow-x-auto thin-scroll shrink-0">
          {sheets!.map((s, i) => (
            <button key={s.name} onClick={() => setActive(i)} className={`text-xs rounded px-2 py-1 whitespace-nowrap ${i === active ? "bg-indigo-600 text-white" : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto thin-scroll">
        <table className="text-xs border-collapse">
          <tbody>
            {sheet?.rows.map((r, i) => (
              <tr key={i} className={i === 0 ? "bg-neutral-50 dark:bg-neutral-800 font-medium" : ""}>
                <td className="px-2 py-1 border border-neutral-200 dark:border-neutral-800 text-neutral-400 tabular-nums">{i + 1}</td>
                {r.map((c, j) => (
                  <td key={j} className="px-2 py-1 border border-neutral-200 dark:border-neutral-800 whitespace-nowrap text-neutral-700 dark:text-neutral-200 max-w-[320px] truncate">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Word as a document page (server-converted, sanitized HTML); PowerPoint as one card per slide (text + notes). */
function OfficePreview({ file, kind }: { file: ViewableFile; kind: "docx" | "pptx" }) {
  const { t } = useT();
  const [data, setData] = useState<{ html?: string; slides?: { n: number; text: string; notes: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/attachments/${file.id}/preview`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || t("att.previewFailed"));
        if (!cancelled) setData(body);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [file.id, t]);
  if (error) return <p className="text-sm text-white/80 max-w-md text-center">{error}</p>;
  if (!data) return <Loader2 size={24} className="animate-spin text-white/70" />;
  if (kind === "docx")
    return (
      <div className="h-full w-full max-w-4xl overflow-auto thin-scroll rounded bg-white dark:bg-neutral-900 shadow-2xl" data-testid="viewer-docx">
        <div className="rich-content mx-auto max-w-3xl px-6 sm:px-12 py-10 text-neutral-800 dark:text-neutral-100" dangerouslySetInnerHTML={{ __html: data.html || `<p>${t("att.emptyDoc")}</p>` }} />
      </div>
    );
  const slides = data.slides ?? [];
  return (
    <div className="h-full w-full max-w-4xl overflow-auto thin-scroll space-y-4 pr-1" data-testid="viewer-pptx">
      {slides.length === 0 && <p className="text-sm text-white/80 text-center">{t("att.emptyDoc")}</p>}
      {slides.map((sl) => (
        <div key={sl.n} className="rounded-lg bg-white dark:bg-neutral-900 shadow-xl overflow-hidden">
          <div className="aspect-[16/9] p-6 sm:p-10 flex flex-col">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 mb-3">{t("att.slide", { n: sl.n })}</div>
            {sl.text.split("\n").map((line, i) => (
              <p key={i} className={i === 0 ? "text-lg sm:text-2xl font-bold text-neutral-900 dark:text-white mb-2" : "text-sm sm:text-base text-neutral-700 dark:text-neutral-300 leading-relaxed"}>
                {line}
              </p>
            ))}
          </div>
          {sl.notes && <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-6 py-3 text-xs text-neutral-500 whitespace-pre-wrap">{t("att.notes")}: {sl.notes}</div>}
        </div>
      ))}
      <p className="text-center text-[11px] text-white/60 pb-2">{t("att.pptxHint")}</p>
    </div>
  );
}
