"use client";
// Opening a thank-you letter: an envelope that opens, then the letter.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import type { KudosDto } from "@/lib/recognition/kudos";
import { Avatar, STYLE_META } from "./shared";
import { KudosComposer } from "./kudos-composer";
import type { MessageKey } from "@/lib/i18n/core";

export function KudosLetter({ workspaceId, workspaceSlug, kudosId, me }: { workspaceId: string; workspaceSlug: string; kudosId: string; me: { id: string; name: string } }) {
  const { t } = useT();
  const router = useRouter();
  const [k, setK] = useState<KudosDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [opened, setOpened] = useState(false);
  const [reply, setReply] = useState(false);
  useEffect(() => {
    api
      .get<KudosDto>(`/api/kudos/${kudosId}`)
      .then((x) => {
        setK(x);
        // The receiver sees the envelope first; everyone else goes straight to the letter.
        if (!x.mine) setOpened(true);
      })
      .catch(() => setMissing(true));
  }, [kudosId]);
  const back = `/w/${workspaceSlug}/recognition?tab=${k?.mine ? "mine" : "wall"}`;

  if (missing) return <div className="p-10 text-center text-sm text-neutral-500">{t("reco.letter.notFound")}</div>;
  if (!k)
    return (
      <div className="p-10 flex justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  return (
    <div className="flex-1 overflow-y-auto thin-scroll bg-gradient-to-b from-amber-50/60 to-transparent dark:from-amber-950/20">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <Link href={back} className="inline-flex items-center gap-1 text-xs text-neutral-500 mb-4">
          <ArrowLeft size={12} /> {t("reco.title")}
        </Link>
        {!opened ? (
          <button onClick={() => setOpened(true)} className="w-full kudos-envelope rounded-3xl p-10 flex flex-col items-center gap-3 kudos-open" data-testid="kudos-envelope">
            <Avatar p={k.from} size={56} />
            <p className="font-serif text-2xl text-amber-950 text-center">{t("reco.popup.title", { name: k.from.name })}</p>
            <span className="kudos-seal h-14 w-14 rounded-full flex items-center justify-center text-2xl">{STYLE_META[k.style]?.emoji ?? "✉"}</span>
            <span className="rounded-full bg-amber-900 text-amber-50 text-sm font-medium px-4 py-1.5">{t("reco.popup.open")}</span>
          </button>
        ) : (
          <article className="kudos-paper rounded-3xl p-8 sm:p-10 font-serif shadow-xl kudos-open" data-testid="kudos-letter">
            <div className="flex items-start gap-3">
              <span className="text-4xl" aria-hidden>
                {STYLE_META[k.style]?.emoji}
              </span>
              <div className="flex-1">
                <p className="text-[11px] uppercase tracking-[0.2em] text-amber-800/70 font-sans">{t(`reco.style.${k.style}` as MessageKey)}</p>
                <h1 className="text-2xl font-semibold leading-tight">{k.title}</h1>
              </div>
            </div>
            <p className="mt-6 text-[16px]">{t("reco.letter.dear", { name: k.to.name })}</p>
            <div className="mt-2 text-[16px] leading-8 whitespace-pre-wrap">{k.message}</div>
            {k.reason && <p className="mt-4 text-sm italic text-amber-900/80">— {t("reco.letter.for", { reason: k.reason })}</p>}
            <p className="mt-6 italic">{t(`reco.letter.closing.${k.style}` as MessageKey)}</p>
            <div className="mt-1 flex items-center gap-2">
              <Avatar p={k.from} size={28} />
              <span className="text-xl" style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive" }}>
                {k.from.name}
              </span>
              <span className="ml-auto text-xs text-amber-900/60 font-sans">{formatDate(k.createdAt, true)}</span>
            </div>
            {(!!k.values.length || k.task) && (
              <div className="mt-6 pt-4 border-t border-amber-900/10 flex flex-wrap items-center gap-2 font-sans text-xs">
                {k.values.map((v) => (
                  <span key={v} className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                    #{t(`reco.value.${v}` as MessageKey)}
                  </span>
                ))}
                {k.task && (
                  <Link href={k.task.href} className="text-indigo-700 hover:underline">
                    ↗ {k.task.title}
                  </Link>
                )}
              </div>
            )}
          </article>
        )}
        {opened && (
          <div className="mt-4 flex justify-center gap-2">
            {k.mine && (
              <Button onClick={() => setReply(true)} data-testid="kudos-reply">
                <Send size={13} /> {t("reco.letter.thankBack", { name: k.from.name })}
              </Button>
            )}
            {k.sentByMe && (
              <Button
                variant="ghost"
                className="text-red-600"
                onClick={async () => {
                  if (!confirm(t("reco.letter.confirmDelete"))) return;
                  await api.delete(`/api/kudos/${k.id}`).catch((e) => toast.error(e.message));
                  router.push(back);
                }}
              >
                <Trash2 size={13} /> {t("common.delete")}
              </Button>
            )}
          </div>
        )}
      </div>
      {reply && <KudosComposer workspaceId={workspaceId} me={me} to={k.from} onClose={() => setReply(false)} onSent={() => setReply(false)} />}
    </div>
  );
}
