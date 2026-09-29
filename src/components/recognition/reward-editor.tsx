"use client";
// Create / edit one reward, with its picture. Used by the catalog admin.
import { useEffect, useRef, useState } from "react";
import { Gift, ImagePlus, Loader2, Save, Trash2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { NumberInput } from "@/components/ui/number-input";
import { api } from "@/lib/api-client";
import type { RewardDto } from "@/lib/recognition/rewards";

/** Downsize a photo in the browser (max 1200px, JPEG/WebP) so uploads stay small and fast. */
export async function shrinkImage(file: File, max = 1200): Promise<Blob> {
  if (file.size < 300 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" ? "image/webp" : "image/jpeg";
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), type, 0.86));
}

export async function uploadRewardImage(rewardId: string, file: Blob) {
  const form = new FormData();
  form.append("file", file, "reward");
  const res = await fetch(`/api/rewards/${rewardId}/image`, { method: "PUT", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Upload failed");
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="block text-xs font-medium text-neutral-700 dark:text-neutral-200 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-neutral-400 mt-1 leading-snug">{hint}</span>}
    </label>
  );
}

export function RewardDialog({ workspaceId, reward, onClose, onSaved }: { workspaceId: string; reward: RewardDto | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useT();
  const [name, setName] = useState(reward?.name ?? "");
  const [description, setDescription] = useState(reward?.description ?? "");
  const [pointsCost, setPointsCost] = useState<number | null>(reward?.pointsCost ?? 100);
  const [price, setPrice] = useState<number | null>(reward?.price ?? null);
  const [currency, setCurrency] = useState(reward?.currency ?? "VND");
  const [quantity, setQuantity] = useState<number | null>(reward?.quantity ?? 1);
  const [active, setActive] = useState(reward?.active ?? true);
  // Picture: a newly picked file, or "remove", or keep what is there.
  const [file, setFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [preview, setPreview] = useState<string | null>(reward?.imageUrl ?? null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preview follows the picked file
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function save(another = false) {
    if (!name.trim()) return toast.error(t("reco.admin.needName"));
    if (!pointsCost) return toast.error(t("reco.admin.needCost"));
    setBusy(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null, pointsCost, price, currency: currency || "VND", quantity: quantity ?? 0, active };
      const saved = reward ? await api.patch<RewardDto>(`/api/rewards/${reward.id}`, body) : await api.post<RewardDto>(`/api/workspaces/${workspaceId}/rewards`, body);
      if (file) await uploadRewardImage(saved.id, await shrinkImage(file));
      else if (removeImage && reward?.imageUrl) await api.delete(`/api/rewards/${saved.id}/image`);
      toast.success(reward ? t("reco.admin.rewardSaved") : t("reco.admin.rewardsAdded", { n: 1 }));
      onSaved();
      if (another && !reward) {
        setName("");
        setDescription("");
        setFile(null);
        setPreview(null);
      } else onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogTitle>{reward ? t("reco.admin.editReward") : t("reco.admin.newReward")}</DialogTitle>
        <div className="mt-3 grid gap-5 md:grid-cols-[15rem_1fr]" data-testid="reward-dialog">
          <div>
            <span className="block text-xs font-medium text-neutral-700 dark:text-neutral-200 mb-1">{t("reco.admin.picture")}</span>
            <button type="button" onClick={() => input.current?.click()} className="group relative w-full aspect-[4/3] rounded-xl overflow-hidden border border-dashed border-neutral-300 dark:border-neutral-700 bg-gradient-to-br from-indigo-50 to-rose-50 dark:from-indigo-950/40 dark:to-rose-950/30 flex items-center justify-center" data-testid="reward-image-pick">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview / authorized image route
                <img src={preview} alt="" className="h-full w-full object-cover" data-testid="reward-image-preview" />
              ) : (
                <span className="flex flex-col items-center gap-1.5 text-neutral-500 text-xs">
                  <Gift size={32} className="text-indigo-400" />
                  {t("reco.admin.pictureEmpty")}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/50 text-white text-xs py-1.5 inline-flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <ImagePlus size={13} /> {preview ? t("reco.admin.pictureChange") : t("reco.admin.image")}
              </span>
            </button>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              data-testid="reward-image-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  setRemoveImage(false);
                }
                e.target.value = "";
              }}
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" type="button" onClick={() => input.current?.click()} className="flex-1">
                <ImagePlus size={12} /> {preview ? t("reco.admin.pictureChange") : t("reco.admin.image")}
              </Button>
              {preview && (
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  className="text-red-600"
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                    setRemoveImage(true);
                  }}
                  aria-label={t("reco.admin.pictureRemove")}
                  data-testid="reward-image-remove"
                >
                  <Trash2 size={12} />
                </Button>
              )}
            </div>
            <p className="text-[11px] text-neutral-400 mt-1.5 leading-snug">{t("reco.admin.pictureHint")}</p>
          </div>
          <div className="space-y-3">
            <Field label={`${t("reco.admin.rewardName")} *`} hint={t("reco.admin.rewardNameHint")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("reco.admin.rewardNamePh")} data-testid="reward-name" />
            </Field>
            <Field label={t("reco.admin.rewardDesc")} hint={t("reco.admin.rewardDescHint")}>
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("reco.admin.rewardDescPh")} data-testid="reward-desc" />
            </Field>
            <div className="grid gap-3 grid-cols-2">
              <Field label={`${t("reco.admin.cost")} *`} hint={t("reco.admin.costHint")}>
                <NumberInput value={pointsCost} min={1} onValueChange={setPointsCost} placeholder="1,000" className="text-right" data-testid="reward-cost" />
              </Field>
              <Field label={`${t("reco.admin.quantity")} *`} hint={reward ? t("reco.admin.quantityMin", { n: reward.approvedCount }) : t("reco.admin.quantityHint")}>
                <NumberInput value={quantity} min={reward?.approvedCount ?? 0} onValueChange={setQuantity} placeholder="10" className="text-right" data-testid="reward-qty" />
              </Field>
              <Field label={t("reco.admin.price")} hint={t("reco.admin.priceHint")}>
                <NumberInput value={price} min={0} onValueChange={setPrice} placeholder="50,000" className="text-right" data-testid="reward-price" />
              </Field>
              <Field label={t("reco.admin.currency")} hint={t("reco.admin.currencyHint")}>
                <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8))} placeholder="VND" />
              </Field>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2">
              <span>
                <span className="block text-xs font-medium">{t("reco.admin.active")}</span>
                <span className="block text-[11px] text-neutral-400">{t("reco.admin.activeHint")}</span>
              </span>
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {!reward && (
            <Button variant="outline" onClick={() => save(true)} disabled={busy}>
              {t("reco.admin.saveAnother")}
            </Button>
          )}
          <Button onClick={() => save()} disabled={busy} data-testid="reward-save">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
