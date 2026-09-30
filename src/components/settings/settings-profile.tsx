"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2, Sparkles, ShieldCheck, Check, Loader2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, initials } from "@/lib/utils";
import { SettingsSection } from "./settings-shell";
import type { MessageKey } from "@/lib/i18n/core";

interface Profile {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  avatarColor: string;
  avatarUrl: string;
  hasUploadedAvatar: boolean;
  aiAbout: string | null;
  aiInstructions: string | null;
  aiTone: string;
  aiLength: string;
  googleLinked: boolean;
  hasPassword: boolean;
}

const COLORS = ["#6366f1", "#0ea5e9", "#14b8a6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#64748b", "#1e3a8a", "#9f1239"];
const TONES = ["professional", "friendly", "concise", "coach", "formal"] as const;
const LENGTHS = ["short", "balanced", "detailed"] as const;
const MAX_AVATAR = 512 * 1024;

/** Downscale a picked image to a 256px square WebP/JPEG so uploads stay small. */
async function toSquare(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const size = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")!.drawImage(bmp, (bmp.width - size) / 2, (bmp.height - size) / 2, size, size, 0, 0, 256, 256);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/webp", 0.9));
}

/** Personal profile: picture, name, job title and AI personalization (custom instructions, tone, length). */
export function SettingsProfile() {
  const { t } = useT();
  const router = useRouter();
  const [p, setP] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Profile>("/api/account/profile").then((x) => {
      setP(x);
      setDraft(x);
    }).catch(() => {});
  }, []);

  if (!p) return <div className="p-6 text-sm text-neutral-400">{t("common.loading")}</div>;
  const v = { ...p, ...draft } as Profile;
  const dirty = (["name", "jobTitle", "avatarColor", "aiAbout", "aiInstructions", "aiTone", "aiLength"] as const).some((k) => (draft[k] ?? null) !== (p[k] ?? null));

  async function save() {
    setSaving(true);
    try {
      const next = await api.patch<Profile>("/api/account/profile", {
        name: v.name,
        jobTitle: v.jobTitle ?? "",
        avatarColor: v.avatarColor,
        aiAbout: v.aiAbout ?? "",
        aiInstructions: v.aiInstructions ?? "",
        aiTone: v.aiTone,
        aiLength: v.aiLength,
      });
      setP(next);
      setDraft(next);
      toast.success(t("common.saved"));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const blob = file.type === "image/gif" || file.size > MAX_AVATAR || !/^image\/(png|jpeg|webp)$/.test(file.type) ? await toSquare(file) : file;
      const form = new FormData();
      form.append("file", blob, "avatar.webp");
      const res = await fetch("/api/account/avatar", { method: "PUT", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("common.failed"));
      setP((x) => (x ? { ...x, avatarUrl: body.avatarUrl, hasUploadedAvatar: true } : x));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeAvatar() {
    await api.delete("/api/account/avatar").catch(() => {});
    setP((x) => (x ? { ...x, hasUploadedAvatar: false, avatarUrl: `/api/users/${x.id}/avatar?v=${Date.now()}` } : x));
    router.refresh();
  }

  const label = "text-xs font-medium text-neutral-500 mb-1 block";
  return (
    <SettingsSection
      title={t("profile.title")}
      description={t("profile.desc")}
      action={
        <Button onClick={save} disabled={!dirty || saving || !v.name.trim()} data-testid="profile-save">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {t("common.save")}
        </Button>
      }
    >
      <div className="max-w-2xl space-y-8">
        <section className="flex flex-col sm:flex-row gap-5">
          <div className="flex flex-col items-center gap-2 shrink-0">
            {p.hasUploadedAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element -- authorized avatar route
              <img src={p.avatarUrl} alt={v.name} className="h-24 w-24 rounded-full object-cover border border-neutral-200 dark:border-neutral-700" data-testid="profile-avatar" />
            ) : (
              <span className="h-24 w-24 rounded-full flex items-center justify-center text-white text-2xl font-semibold" style={{ backgroundColor: v.avatarColor }} data-testid="profile-avatar">
                {initials(v.name || "?")}
              </span>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} data-testid="profile-avatar-input" />
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />} {t("profile.upload")}
              </Button>
              {p.hasUploadedAvatar && (
                <Button size="sm" variant="ghost" onClick={removeAvatar} aria-label={t("common.remove")}>
                  <Trash2 size={12} />
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>{t("profile.name")}</label>
                <Input value={v.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} maxLength={120} data-testid="profile-name" />
              </div>
              <div>
                <label className={label}>{t("profile.jobTitle")}</label>
                <Input value={v.jobTitle ?? ""} onChange={(e) => setDraft((d) => ({ ...d, jobTitle: e.target.value }))} maxLength={120} placeholder={t("profile.jobTitlePh")} data-testid="profile-job" />
              </div>
            </div>
            <div>
              <label className={label}>{t("profile.email")}</label>
              <div className="text-sm text-neutral-700 dark:text-neutral-300">
                {p.email}
                {p.googleLinked && <span className="ml-2 rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-500">Google</span>}
              </div>
              {!p.hasPassword && <p className="text-[11px] text-neutral-400 mt-1">{t("profile.noPassword")}</p>}
            </div>
            {!p.hasUploadedAvatar && (
              <div>
                <label className={label}>{t("profile.color")}</label>
                <div className="flex flex-wrap gap-1.5">
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => setDraft((d) => ({ ...d, avatarColor: c }))} className={cn("h-7 w-7 rounded-full flex items-center justify-center text-white", v.avatarColor === c && "ring-2 ring-offset-2 ring-neutral-900 dark:ring-neutral-100 dark:ring-offset-neutral-900")} style={{ backgroundColor: c }} aria-label={c}>
                      {v.avatarColor === c && <Check size={13} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-4" data-testid="profile-ai">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
              <Sparkles size={14} className="text-indigo-500" /> {t("profile.ai.title")}
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">{t("profile.ai.desc")}</p>
          </div>
          <div>
            <label className={label}>{t("profile.ai.about")}</label>
            <textarea
              value={v.aiAbout ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, aiAbout: e.target.value }))}
              rows={3}
              maxLength={3000}
              placeholder={t("profile.ai.aboutPh")}
              className="w-full rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              data-testid="profile-ai-about"
            />
          </div>
          <div>
            <label className={label}>{t("profile.ai.instructions")}</label>
            <textarea
              value={v.aiInstructions ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, aiInstructions: e.target.value }))}
              rows={4}
              maxLength={3000}
              placeholder={t("profile.ai.instructionsPh")}
              className="w-full rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              data-testid="profile-ai-instructions"
            />
            <div className="text-[10px] text-neutral-400 text-right">{(v.aiInstructions ?? "").length}/3000</div>
          </div>
          <div>
            <label className={label}>{t("profile.ai.tone")}</label>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((x) => (
                <button key={x} onClick={() => setDraft((d) => ({ ...d, aiTone: x }))} className={cn("rounded-full border px-3 py-1 text-xs", v.aiTone === x ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300")} data-testid={`profile-tone-${x}`}>
                  {t(`profile.tone.${x}` as MessageKey)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={label}>{t("profile.ai.length")}</label>
            <div className="inline-flex rounded-lg bg-neutral-100 dark:bg-neutral-800 p-0.5">
              {LENGTHS.map((x) => (
                <button key={x} onClick={() => setDraft((d) => ({ ...d, aiLength: x }))} className={cn("rounded-md px-3 py-1 text-xs", v.aiLength === x ? "bg-white dark:bg-neutral-900 shadow-sm font-medium" : "text-neutral-500")}>
                  {t(`profile.length.${x}` as MessageKey)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 p-3 text-xs text-neutral-600 dark:text-neutral-300">
            <ShieldCheck size={15} className="text-indigo-600 shrink-0 mt-0.5" />
            <span>{t("profile.ai.scope")}</span>
          </div>
        </section>
      </div>
    </SettingsSection>
  );
}
