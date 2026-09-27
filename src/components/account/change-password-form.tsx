"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";

export function ChangePasswordForm({ email, forced }: { email: string; forced: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      toast.error(t("pw.mismatch"));
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/account/password", { currentPassword: current, newPassword: next });
      toast.success(t("pw.updated"));
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.failed"));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <KeyRound size={18} className="text-indigo-600" />
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{forced ? t("pw.choose") : t("pw.change")}</h1>
      </div>
      <p className="text-sm text-neutral-500">
        {forced ? t("pw.forcedHint") : email}
      </p>
      <div>
        <label htmlFor="current" className="text-xs font-medium text-neutral-500 mb-1 block">{forced ? t("pw.temporary") : t("pw.current")}</label>
        <Input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div>
        <label htmlFor="new" className="text-xs font-medium text-neutral-500 mb-1 block">{t("pw.new")}</label>
        <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        <p className="text-[11px] text-neutral-400 mt-1">{t("auth.passwordHint")}</p>
      </div>
      <div>
        <label htmlFor="confirm" className="text-xs font-medium text-neutral-500 mb-1 block">{t("pw.confirm")}</label>
        <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      <div className="flex items-center justify-between pt-2">
        {forced ? (
          <button type="button" onClick={() => signOut({ callbackUrl: "/" })} className="text-sm text-neutral-500 hover:underline">{t("auth.signOut")}</button>
        ) : (
          <button type="button" onClick={() => router.back()} className="text-sm text-neutral-500 hover:underline">{t("common.cancel")}</button>
        )}
        <Button type="submit" disabled={saving}>{saving ? t("common.saving") : t("pw.submit")}</Button>
      </div>
    </form>
  );
}
