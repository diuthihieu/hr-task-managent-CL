"use client";
import { useEffect, useState } from "react";
import { Mail, Send, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";

interface MailStatus {
  configured: boolean;
  missing: string[];
  from: string | null;
  testSender: boolean;
}

/** Email delivery check for system admins: what's configured and a test send with the provider's answer. */
export function MailCheckPanel() {
  const { t } = useT();
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string; to: string } | null>(null);
  useEffect(() => {
    api.get<MailStatus>("/api/admin/mail").then(setStatus).catch(() => {});
  }, []);
  if (!status) return null;
  return (
    <div className="mb-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 text-sm" data-testid="mail-check">
      <div className="flex flex-wrap items-center gap-2">
        <Mail size={15} className="text-indigo-600" />
        <span className="font-semibold">{t("mail.title")}</span>
        {status.configured ? (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">{t("mail.configured", { from: status.from ?? "" })}</span>
        ) : (
          <span className="text-xs text-amber-700 dark:text-amber-400">{t("mail.missing", { vars: status.missing.join(", ") })}</span>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={busy || !status.configured}
          onClick={async () => {
            setBusy(true);
            try {
              setResult(await api.post<{ ok: boolean; error?: string; to: string }>("/api/admin/mail", {}));
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t("common.failed"));
            } finally {
              setBusy(false);
            }
          }}
          data-testid="mail-test"
        >
          <Send size={13} /> {t("mail.test")}
        </Button>
      </div>
      {status.testSender && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t("mail.testSender")}</p>}
      {!status.configured && <p className="mt-2 text-xs text-neutral-500">{t("mail.howTo")}</p>}
      {result && (
        <p className={`mt-2 text-xs flex items-start gap-1.5 ${result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`} data-testid="mail-result">
          {result.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
          <span className="break-words">{result.ok ? t("mail.sent", { to: result.to }) : t("mail.failed", { error: result.error ?? "" })}</span>
        </p>
      )}
    </div>
  );
}
