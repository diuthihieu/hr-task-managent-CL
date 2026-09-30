"use client";
import { useEffect, useMemo, useState } from "react";
import { ConvertToWikiDialog } from "./convert-to-wiki-dialog";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Plus, Trash2, Sparkles, ShieldCheck, MessageSquare } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";
import { ChatThread } from "./chat-thread";
import { useAiChat, type ChatMessage } from "./use-ai-chat";
import { exportReportPdf } from "./print-report";
import { MetaChip } from "@/components/ui/meta";

/** Workspace AI Assistant: reports and Q&A over everything the user may see, with PDF export. */
export function AiAssistant({ workspaceId, workspaceName, logoUrl, userName }: { workspaceId: string; workspaceName: string; logoUrl: string | null; userName: string }) {
  const { t, locale } = useT();
  const chat = useAiChat({ kind: "assistant", workspaceId });
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialQuestion = searchParams.get("q");
  const [convert, setConvert] = useState<string | null>(null);
  const workspaceSlug = pathname.split("/")[2] ?? "";

  // Ctrl+K "Ask AI": /ai?q=... starts a new chat with that question.
  useEffect(() => {
    if (!initialQuestion?.trim()) return;
    router.replace(pathname);
    chat.open(null);
    chat.send(initialQuestion.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per question
  }, [initialQuestion]);

  useEffect(() => {
    chat.loadConversations().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per workspace
  }, [workspaceId]);

  const suggestions = useMemo(() => [t("ai.s.weekly"), t("ai.s.overdue"), t("ai.s.okr"), t("ai.s.today")], [t]);

  function exportPdf(m: ChatMessage) {
    const title = m.content.match(/^#\s+(.+)$/m)?.[1]?.trim() || chat.conversations.find((c) => c.id === chat.conversationId)?.title || t("nav.ai");
    exportReportPdf({ markdown: m.content, title, workspace: workspaceName, author: userName, logoUrl: logoUrl ? new URL(logoUrl, window.location.origin).href : null, locale });
  }

  return (
    <div className="flex-1 flex overflow-hidden" data-testid="ai-assistant">
      <aside className="hidden md:flex w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex-col">
        <div className="p-3">
          <Button className="w-full" onClick={() => chat.open(null)} data-testid="ai-new-chat">
            <Plus size={14} /> {t("ai.newChat")}
          </Button>
        </div>
        <div className="px-3 pb-1 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">{t("ai.history")}</div>
        <div className="flex-1 overflow-y-auto thin-scroll px-2 pb-2 space-y-0.5">
          {chat.conversations.length === 0 && <div className="px-2 py-2 text-xs text-neutral-400">{t("ai.noHistory")}</div>}
          {chat.conversations.map((c) => (
            <div key={c.id} className={cn("group flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer", c.id === chat.conversationId ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300" : "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300")} onClick={() => chat.open(c.id)} data-testid="ai-conversation">
              <MessageSquare size={13} className="shrink-0 opacity-60" />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[13px]">{c.title}</span>
                <span className="block text-[10px] text-neutral-400">{formatDate(c.updatedAt, true)}</span>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(t("ai.deleteConfirm"))) chat.remove(c.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-600"
                aria-label={t("common.delete")}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="m-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 p-3 text-[11px] text-neutral-500 flex gap-2">
          <ShieldCheck size={14} className="text-indigo-600 shrink-0 mt-0.5" />
          <span>{t("ai.scopeNote")}</span>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0 bg-neutral-50 dark:bg-neutral-950">
        <div className="h-12 shrink-0 px-6 flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
          <Sparkles size={16} className="text-indigo-600" />
          <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{t("nav.ai")}</h1>
          <MetaChip className="ml-1">{workspaceName}</MetaChip>
        </div>
        <ChatThread
          messages={chat.messages}
          busy={chat.busy}
          error={chat.error}
          errorStatus={chat.errorStatus}
          failedText={chat.failedText}
          onRetry={chat.retry}
          configured={chat.configured}
          onSend={chat.send}
          onStop={chat.stop}
          onExportPdf={exportPdf}
          onConvertToWiki={(m) => setConvert(m.content)}
          emptyTitle={t("ai.emptyTitle", { name: userName.split(" ").slice(-1)[0] })}
          emptyBody={t("ai.emptyBody")}
          suggestions={suggestions}
          placeholder={t("ai.placeholder")}
        />
      </main>
      <ConvertToWikiDialog markdown={convert} workspaceId={workspaceId} workspaceSlug={workspaceSlug} onClose={() => setConvert(null)} />
    </div>
  );
}
