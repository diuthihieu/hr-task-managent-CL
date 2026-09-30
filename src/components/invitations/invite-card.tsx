"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Building2, Check, Loader2, MailWarning, Users, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/brand/brand";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import type { MessageKey } from "@/lib/i18n/core";

interface InviteInfo {
  kind: "invitation" | "link";
  state: string;
  email: string | null;
  role: string;
  message: string | null;
  invitedBy: string | null;
  workspaceName: string;
  members: number;
}

/** Accept / decline an invitation to a workspace. Nothing happens until the person chooses. */
export function InviteCard({ token, user, invite }: { token: string; user: { name: string; email: string }; invite: InviteInfo | null }) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [declined, setDeclined] = useState(false);
  const wrongAccount = invite?.kind === "invitation" && invite.email && invite.email.toLowerCase() !== user.email.toLowerCase();

  async function respond(decision: "accept" | "decline") {
    setBusy(decision);
    try {
      const r = await api.post<{ joined: boolean; slug: string | null }>(`/api/invite/${token}`, { decision });
      if (r.joined && r.slug) {
        toast.success(t("inv.joined", { name: invite?.workspaceName ?? "" }));
        router.push(`/w/${r.slug}`);
        router.refresh();
        return;
      }
      setDeclined(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
    setBusy(null);
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center justify-center p-4">
      <Brand className="mb-6" />
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm" data-testid="invite-card">
        {!invite ? (
          <State icon={<X size={20} />} title={t("inv.notFound")} body={t("inv.notFoundBody")} />
        ) : declined ? (
          <State icon={<Check size={20} />} title={t("inv.declinedTitle")} body={t("inv.declinedBody", { name: invite.workspaceName })} />
        ) : invite.state !== "pending" ? (
          <State icon={<X size={20} />} title={t(`inv.state.${invite.state}` as MessageKey)} body={t("inv.askNew")} />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="h-12 w-12 rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 flex items-center justify-center shrink-0">
                <Building2 size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-neutral-500">{invite.invitedBy ? t("inv.invitedBy", { name: invite.invitedBy }) : t("inv.invitedToJoin")}</p>
                <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 truncate" data-testid="invite-workspace">{invite.workspaceName}</h1>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4 text-xs text-neutral-600 dark:text-neutral-300">
              <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1">
                <Users size={12} /> {t("inv.members", { count: invite.members })}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 px-2.5 py-1">
                {t("inv.youJoinAs", { role: t(`role.${invite.role}` as MessageKey) })}
              </span>
            </div>
            {invite.message && <p className="mt-4 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-200 whitespace-pre-line">“{invite.message}”</p>}

            {wrongAccount ? (
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-3 text-sm text-amber-900 dark:text-amber-100" data-testid="invite-wrong-account">
                <p className="flex items-start gap-2">
                  <MailWarning size={16} className="shrink-0 mt-0.5" /> {t("inv.wrongAccount", { invited: invite.email ?? "", current: user.email })}
                </p>
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => signOut({ callbackUrl: `/?auth=login&callbackUrl=${encodeURIComponent(`/invite/${token}`)}` })}>
                  {t("inv.switchAccount")}
                </Button>
              </div>
            ) : (
              <>
                <p className="mt-5 text-xs text-neutral-500">{t("inv.signedInAs", { email: user.email })}</p>
                <div className="flex gap-2 mt-2">
                  <Button className="flex-1 justify-center" onClick={() => respond("accept")} disabled={!!busy} data-testid="invite-accept">
                    {busy === "accept" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t("inv.accept")}
                  </Button>
                  <Button variant="secondary" className="flex-1 justify-center" onClick={() => respond("decline")} disabled={!!busy} data-testid="invite-decline">
                    {busy === "decline" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} {t("inv.decline")}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <a href="/workspaces" className="mt-4 text-xs text-neutral-500 hover:text-indigo-600">{t("inv.toWorkspaces")}</a>
    </div>
  );
}

function State({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="text-center py-4" data-testid="invite-state">
      <span className="mx-auto h-11 w-11 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 flex items-center justify-center">{icon}</span>
      <h1 className="mt-3 font-semibold text-neutral-900 dark:text-neutral-50">{title}</h1>
      <p className="mt-1 text-sm text-neutral-500">{body}</p>
    </div>
  );
}
