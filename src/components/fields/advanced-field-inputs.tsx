"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Crosshair, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

export interface LocationValue {
  address?: string;
  lat?: number;
  lng?: number;
}

export function LocationInput({ value, onChange, compact = false }: { value: unknown; onChange: (value: LocationValue | null) => void; compact?: boolean }) {
  const location = value && typeof value === "object" && !Array.isArray(value) ? (value as LocationValue) : {};
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<LocationValue>) => {
    const next = { ...location, ...patch };
    onChange(next.address || next.lat !== undefined || next.lng !== undefined ? next : null);
  };
  const locate = () => {
    if (!navigator.geolocation) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        update({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) });
        setBusy(false);
      },
      () => setBusy(false),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  };
  return (
    <div className={compact ? "flex items-center gap-1 w-full" : "space-y-2"}>
      <Input value={location.address ?? ""} onChange={(e) => update({ address: e.target.value.slice(0, 500) })} placeholder="Address or place" className={compact ? "h-7 border-0" : undefined} />
      {!compact && (
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Input type="number" step="any" value={location.lat ?? ""} onChange={(e) => update({ lat: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="Latitude" />
          <Input type="number" step="any" value={location.lng ?? ""} onChange={(e) => update({ lng: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="Longitude" />
          <Button type="button" variant="secondary" onClick={locate} disabled={busy} title="Use current location"><Crosshair size={14} /></Button>
        </div>
      )}
      {compact && <button type="button" onClick={locate} disabled={busy} className="text-neutral-400 hover:text-indigo-600 px-1" title="Use current location"><Crosshair size={13} /></button>}
    </div>
  );
}

export function JsonInput({ value, onChange, compact = false }: { value: unknown; onChange: (value: unknown) => void; compact?: boolean }) {
  const external = value === null || value === undefined ? "" : JSON.stringify(value, null, compact ? 0 : 2);
  const [draft, setDraft] = useState(external);
  const [error, setError] = useState(false);
  const [lastExternal, setLastExternal] = useState(external);
  if (external !== lastExternal) {
    setLastExternal(external);
    setDraft(external);
    setError(false);
  }
  const commit = () => {
    if (!draft.trim()) {
      setError(false);
      onChange(null);
      return;
    }
    try {
      onChange(JSON.parse(draft));
      setError(false);
    } catch {
      setError(true);
    }
  };
  return (
    <div className="w-full">
      <Textarea rows={compact ? 1 : 8} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} className={error ? "border-red-500 font-mono text-xs" : "font-mono text-xs"} />
      {error && !compact && <p className="text-xs text-red-500 mt-1">Invalid JSON</p>}
    </div>
  );
}

export function SignatureInput({ value, onChange }: { value: unknown; onChange: (value: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const signature = typeof value === "string" ? value : "";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (signature) {
      const img = new window.Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = signature;
    }
  }, [signature]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * canvas.width, y: ((e.clientY - rect.top) / rect.height) * canvas.height };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = e.currentTarget.getContext("2d");
    const p = point(e);
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    const p = point(e);
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(e.currentTarget.toDataURL("image/png"));
  };
  return (
    <div className="space-y-2">
      <canvas ref={canvasRef} width={520} height={160} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} className="w-full h-32 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white touch-none cursor-crosshair" />
      <Button type="button" size="sm" variant="secondary" onClick={() => onChange(null)}><Eraser size={13} /> Clear</Button>
    </div>
  );
}

const CODE39: Record<string, string> = {
  "0":"nnwwnwnnw","1":"wnnwnnnnw","2":"nnwwnnnnw","3":"wnwwnnnnn","4":"nnnwwnnnw","5":"wnnwwnnnn","6":"nnwwwnnnn","7":"nnnwnnwnw","8":"wnnwnnwnn","9":"nnwwnnwnn",
  A:"wnnnnwnnw",B:"nnwnnwnnw",C:"wnwnnwnnn",D:"nnnnwwnnw",E:"wnnnwwnnn",F:"nnwnwwnnn",G:"nnnnnwwnw",H:"wnnnnwwnn",I:"nnwnnwwnn",J:"nnnnwwwnn",
  K:"wnnnnnnww",L:"nnwnnnnww",M:"wnwnnnnwn",N:"nnnnwnnww",O:"wnnnwnnwn",P:"nnwnwnnwn",Q:"nnnnnnwww",R:"wnnnnnwwn",S:"nnwnnnwwn",T:"nnnnwnwwn",
  U:"wwnnnnnnw",V:"nwwnnnnnw",W:"wwwnnnnnn",X:"nwnnwnnnw",Y:"wwnnwnnnn",Z:"nwwnwnnnn","-":"nwnnnnwnw",".":"wwnnnnwnn"," ":"nwwnnnwnn","$":"nwnwnwnnn","/":"nwnwnnnwn","+":"nwnnnwnwn","%":"nnnwnwnwn","*":"nwnnwnwnn",
};

/** Scannable Code 39 SVG; unsupported characters are replaced with a space. */
export function Barcode({ value }: { value: unknown }) {
  const text = String(value ?? "").toUpperCase().slice(0, 80).replace(/[^0-9A-Z. $/+%-]/g, " ");
  if (!text) return <span className="text-neutral-300">—</span>;
  const encoded = `*${text}*`;
  let x = 4;
  const bars: React.ReactNode[] = [];
  for (const [ci, char] of [...encoded].entries()) {
    const pattern = CODE39[char] ?? CODE39[" "];
    for (let i = 0; i < pattern.length; i++) {
      const width = pattern[i] === "w" ? 3 : 1;
      if (i % 2 === 0) bars.push(<rect key={`${ci}-${i}`} x={x} y={2} width={width} height={34} fill="currentColor" />);
      x += width;
    }
    x += 1;
  }
  return (
    <svg viewBox={`0 0 ${x + 4} 48`} role="img" aria-label={`Barcode ${text}`} className="w-full h-11 text-neutral-900 dark:text-neutral-100">
      {bars}
      <text x={(x + 4) / 2} y="46" textAnchor="middle" fontSize="7" fill="currentColor">{text}</text>
    </svg>
  );
}

export function SignaturePreview({ value }: { value: unknown }) {
  return typeof value === "string" && value.startsWith("data:image/png;base64,") ? <Image src={value} width={160} height={48} unoptimized alt="Signature" className="max-h-10 w-auto" /> : <span className="text-neutral-300">—</span>;
}
