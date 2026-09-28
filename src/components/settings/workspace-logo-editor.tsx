"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Wand2, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn, initials } from "@/lib/utils";
import { WorkspaceAvatar } from "@/components/workspaces/workspace-avatar";

const BG = ["#ea580c", "#f97316", "#dc2626", "#db2777", "#9333ea", "#4f46e5", "#2563eb", "#0891b2", "#059669", "#65a30d", "#ca8a04", "#171717"];
const SHAPES = ["rounded", "circle", "square"] as const;
const SIZE = 256;

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))), "image/png"));
}

function drawGenerated(canvas: HTMLCanvasElement, text: string, bg: string, shape: (typeof SHAPES)[number]) {
  const ctx = canvas.getContext("2d")!;
  canvas.width = SIZE;
  canvas.height = SIZE;
  ctx.clearRect(0, 0, SIZE, SIZE);
  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, shade(bg, -0.18));
  ctx.fillStyle = grad;
  ctx.beginPath();
  if (shape === "circle") ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  else ctx.roundRect(0, 0, SIZE, SIZE, shape === "rounded" ? 56 : 0);
  ctx.fill();
  const label = [...text.trim()].slice(0, 3).join("") || "W";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const len = [...label].length;
  ctx.font = `700 ${len === 1 ? 150 : len === 2 ? 118 : 88}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(label, SIZE / 2, SIZE / 2 + 8);
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + c * amt)));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

/** Square-crop and downscale an uploaded image so the logo stays small. */
async function normalizeUpload(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  return canvasToBlob(canvas);
}

export function WorkspaceLogoEditor({ workspaceId, name, logoUrl, canEdit, onChange }: { workspaceId: string; name: string; logoUrl: string | null; canEdit: boolean; onChange: (url: string | null) => void }) {
  const { t } = useT();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"view" | "generate">("view");
  const [text, setText] = useState(initials(name));
  const [bg, setBg] = useState(BG[0]);
  const [shape, setShape] = useState<(typeof SHAPES)[number]>("rounded");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === "generate" && canvasRef.current) drawGenerated(canvasRef.current, text, bg, shape);
  }, [mode, text, bg, shape]);

  async function upload(blob: Blob) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", blob, "logo.png");
      const res = await fetch(`/api/workspaces/${workspaceId}/logo`, { method: "PUT", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("common.failed"));
      onChange(body.logoUrl);
      setMode("view");
      toast.success(t("logo.saved"));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t("logo.removeConfirm"))) return;
    await api.delete(`/api/workspaces/${workspaceId}/logo`).catch(() => {});
    onChange(null);
    router.refresh();
  }

  return (
    <div data-testid="logo-editor">
      <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("logo.title")}</label>
      <div className="flex items-center gap-4">
        {mode === "generate" ? (
          <canvas ref={canvasRef} className="h-16 w-16" style={{ width: 64, height: 64 }} data-testid="logo-canvas" />
        ) : (
          <WorkspaceAvatar name={name} logoUrl={logoUrl} size={64} className="rounded-2xl" />
        )}
        {canEdit && mode === "view" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={13} /> {t("logo.upload")}
            </Button>
            <Button variant="outline" onClick={() => setMode("generate")} data-testid="logo-generate">
              <Wand2 size={13} /> {t("logo.generate")}
            </Button>
            {logoUrl && (
              <Button variant="ghost" onClick={remove}>
                <Trash2 size={13} /> {t("common.delete")}
              </Button>
            )}
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload(await normalizeUpload(f).catch(() => f));
        }}
      />
      {mode === "generate" && (
        <div className="mt-3 space-y-3 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
          <div>
            <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("logo.text")}</label>
            <Input value={text} maxLength={3} onChange={(e) => setText(e.target.value)} className="w-24" data-testid="logo-text" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("logo.color")}</label>
            <div className="flex flex-wrap gap-1.5">
              {BG.map((c) => (
                <button key={c} onClick={() => setBg(c)} className={cn("h-6 w-6 rounded-full border-2", bg === c ? "border-neutral-900 dark:border-white" : "border-transparent")} style={{ backgroundColor: c }} aria-label={c} />
              ))}
            </div>
          </div>
          <div className="flex gap-1.5">
            {SHAPES.map((s) => (
              <button key={s} onClick={() => setShape(s)} className={cn("text-xs rounded-md px-2 py-1 border", shape === s ? "border-indigo-500 text-indigo-700 bg-indigo-50 dark:bg-indigo-950" : "border-neutral-200 dark:border-neutral-700 text-neutral-600")}>
                {t(`logo.shape.${s}`)}
              </button>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setMode("view")}>
              {t("common.cancel")}
            </Button>
            <Button onClick={async () => canvasRef.current && upload(await canvasToBlob(canvasRef.current))} disabled={busy} data-testid="logo-use">
              {t("logo.use")}
            </Button>
          </div>
        </div>
      )}
      <p className="text-[11px] text-neutral-400 mt-2">{t("logo.hint")}</p>
    </div>
  );
}
