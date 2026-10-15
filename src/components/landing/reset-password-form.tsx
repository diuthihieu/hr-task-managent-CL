"use client";
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/i18n-provider";

export function ResetPasswordForm({ token }: { token: string }) {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError(t("auth.passwordMismatch"));
    setLoading(true);
    try {
      const res = await fetch("/api/account/password-reset/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) throw new Error(body.code === "invalid_token" ? t("reset.invalid") : body.error || t("common.failed"));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-xl shadow-indigo-500/5" data-testid="reset-card">
      {done ? (
        <div className="text-center" data-testid="reset-done">
          <CheckCircle2 size={36} className="mx-auto text-emerald-600" />
          <h1 className="mt-3 text-lg font-semibold text-neutral-900 dark:text-neutral-50">{t("reset.doneTitle")}</h1>
          <p className="mt-1 text-sm text-neutral-500">{t("reset.doneBody")}</p>
          <Link href="/?auth=login#auth" className="mt-5 inline-flex h-9 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500">
            {t("auth.signIn")}
          </Link>
        </div>
      ) : !token ? (
        <div className="text-center">
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{t("reset.title")}</h1>
          <p className="mt-2 text-sm text-neutral-500">{t("reset.invalid")}</p>
          <Link href="/?auth=forgot#auth" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline">{t("auth.forgot.again")}</Link>
        </div>
      ) : (
        <>
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600">
            <KeyRound size={18} />
          </span>
          <h1 className="mt-3 text-lg font-semibold text-neutral-900 dark:text-neutral-50">{t("reset.title")}</h1>
          <p className="text-sm text-neutral-500 mb-4">{t("reset.sub")}</p>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label htmlFor="reset-password" className="text-xs font-medium text-neutral-500 mb-1 block">{t("reset.new")}</label>
              <Input id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus />
              <p className="text-[11px] text-neutral-400 mt-1">{t("auth.passwordHint")}</p>
            </div>
            <div>
              <label htmlFor="reset-confirm" className="text-xs font-medium text-neutral-500 mb-1 block">{t("auth.confirmPassword")}</label>
              <Input id="reset-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            {error && <p className="text-xs text-red-600" data-testid="reset-error">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full justify-center" data-testid="reset-submit">
              {loading ? t("reset.saving") : t("reset.save")}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
