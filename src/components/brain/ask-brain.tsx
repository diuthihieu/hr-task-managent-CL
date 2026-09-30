"use client";
// Ask My Brain: scoped, source-grounded answers. Every answer lists the
// sources the AI was given, marks the ones it cited, and links each [S#].
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Send, History, Plus, X, AlertTriangle, Lightbulb, CheckSquare, Gavel, FileText, Sparkles } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { markdownToHtml } from "@/components/ai/markdown";
import { LinkPicker, type LinkTarget } from "./link-picker";
import type { MessageKey } from "@/lib/i18n/core";
import { Meta, MetaChip, MetaStatus } from "@/components/ui/meta";

interface Source {
  n: number;
  type: string;
  id: string;
  title: string;
  href?: string;
  status?: string;
  historical?: boolean;
  updatedAt?: string;
  author?: string | null;
  snippet?: string;
  used?: boolean;
}
interface Turn {
  role: "user" | "model";
  content: string;
  sources?: Source[];
  grounded?: boolean;
}
type ScopeType = "everything" | "project" | "wiki" | "sources" | "mine";

export function AskBrain({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const [scope, setScope] = useState<ScopeType>("everything");
  const [projectId, setProjectId] = useState("");
  const [wikiId, setWikiId] = useState("");
  const [picked, setPicked] = useState<LinkTarget[]>([]);
  const [picking, setPicking] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [wikis, setWikis] = useState<{ id: string; name: string }[]>([]);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [history, setHistory] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [ctx, setCtx] = useState<{ myTasks: { id: string; title: string }[]; recentDecisions: { id: string; title: string }[]; relatedToWork: { id: string; title: string }[] } | null>(null);

  useEffect(() => {
    api.get<NonNullable<typeof ctx>>(`/api/workspaces/${workspaceId}/brain/for-you`).then(setCtx).catch(() => {});
    api.get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/projects`).then((p) => { setProjects(p); setProjectId((x) => x || p[0]?.id || ""); }).catch(() => {});
    api.get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/wikis`).then((w) => { setWikis(w); setWikiId((x) => x || w[0]?.id || ""); }).catch(() => {});
    api.get<{ id: string; title: string }[]>(`/api/workspaces/${workspaceId}/brain/ask`).then(setHistory).catch(() => {});
  }, [workspaceId]);

  // Questions built from what the user is working on right now.
  const suggestions = useMemo(() => {
    const out: { q: string; icon: "task" | "decision" | "page" | "general" }[] = [];
    ctx?.myTasks.slice(0, 2).forEach((x) => out.push({ q: t("brain.ask.sug.task", { title: x.title }), icon: "task" }));
    if (ctx?.recentDecisions[0]) out.push({ q: t("brain.ask.sug.decision", { title: ctx.recentDecisions[0].title }), icon: "decision" });
    if (ctx?.relatedToWork[0]) out.push({ q: t("brain.ask.sug.page", { title: ctx.relatedToWork[0].title }), icon: "page" });
    out.push({ q: t("brain.ask.sug.week"), icon: "general" }, { q: t("brain.ask.sug.decisionsMine"), icon: "general" });
    return out.slice(0, 6);
  }, [ctx, t]);

  async function ask(preset?: string) {
    const q = (preset ?? question).trim();
    if (!q || busy) return;
    setBusy(true);
    setTurns((x) => [...x, { role: "user", content: q }]);
    setQuestion("");
    try {
      const r = await api.post<{ answer: string; sources: Source[]; conversationId: string; grounded: boolean }>(`/api/workspaces/${workspaceId}/brain/ask`, {
        question: q,
        scope: { type: scope, ...(scope === "project" ? { projectId } : {}), ...(scope === "wiki" ? { wikiId } : {}), ...(scope === "sources" ? { sources: picked.map((p) => `${p.type}:${p.id}`) } : {}) },
        conversationId,
      });
      if (!conversationId) setHistory((h) => [{ id: r.conversationId, title: q.slice(0, 120) }, ...h]);
      setConversationId(r.conversationId);
      setTurns((x) => [...x, { role: "model", content: r.answer, sources: r.sources, grounded: r.grounded }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      setTurns((x) => x.slice(0, -1));
      setQuestion(q);
    } finally {
      setBusy(false);
    }
  }
  async function openConversation(id: string) {
    const c = await api.get<{ id: string; messages: { role: "user" | "model"; content: string; sources: Source[] | null }[] }>(`/api/workspaces/${workspaceId}/brain/ask?conversationId=${id}`);
    setConversationId(c.id);
    setTurns(c.messages.map((m) => ({ role: m.role, content: m.content, sources: m.sources ?? undefined, grounded: !!m.sources?.some((s) => s.used) })));
  }

  const sel = "h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm";
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_16rem]" data-testid="ask-brain">
      <div className="space-y-3">
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-neutral-600 dark:text-neutral-300">{t("brain.ask.context")}</span>
            {(["everything", "project", "wiki", "sources", "mine"] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} className={cn("h-7 px-2.5 rounded-full border", scope === s ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-300 dark:border-neutral-700")} data-testid={`ask-scope-${s}`}>
                {t(`brain.ask.scope.${s}` as MessageKey)}
              </button>
            ))}
          </div>
          {scope === "project" && (
            <select className={sel} value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="ask-project">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {scope === "wiki" && (
            <select className={sel} value={wikiId} onChange={(e) => setWikiId(e.target.value)} data-testid="ask-wiki">
              {wikis.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          {scope === "sources" && (
            <div className="relative flex flex-wrap items-center gap-1.5">
              {picked.map((p) => (
                <span key={`${p.type}${p.id}`} className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-neutral-100 dark:bg-neutral-800 text-xs">
                  {p.label}
                  <button onClick={() => setPicked(picked.filter((x) => x !== p))}>
                    <X size={10} />
                  </button>
                </span>
              ))}
              <button onClick={() => setPicking(true)} className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 text-xs" data-testid="ask-add-source">
                <Plus size={11} /> {t("brain.ask.addSource")}
              </button>
              {picking && (
                <div className="absolute z-40 top-7 left-0">
                  <LinkPicker
                    workspaceId={workspaceId}
                    types={["wiki", "task", "decision", "objective", "file"]}
                    onPick={(x) => {
                      setPicked((p) => (p.some((y) => y.id === x.id) ? p : [...p, x]));
                      setPicking(false);
                    }}
                    onClose={() => setPicking(false)}
                  />
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Textarea
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask();
                }
              }}
              placeholder={t("brain.ask.placeholder")}
              data-testid="ask-input"
            />
            <Button onClick={() => ask()} disabled={busy || !question.trim() || (scope === "sources" && !picked.length)} className="self-end" data-testid="ask-send">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </Button>
          </div>
          <p className="text-[11px] text-neutral-400">{t("brain.ask.hint")}</p>
        </div>

        {!turns.length && !busy && (
          <div className="grid gap-3 md:grid-cols-2" data-testid="ask-empty">
            <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
              <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-1.5 inline-flex items-center gap-1.5">
                <Lightbulb size={13} className="text-indigo-600" /> {t("brain.ask.suggested")}
              </p>
              <div className="space-y-1">
                {suggestions.map((x) => {
                  const Icon = x.icon === "task" ? CheckSquare : x.icon === "decision" ? Gavel : x.icon === "page" ? FileText : Sparkles;
                  return (
                    <button key={x.q} onClick={() => ask(x.q)} className="w-full text-left flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/40" data-testid="ask-suggestion">
                      <Icon size={13} className="text-neutral-400 mt-0.5 shrink-0" />
                      <span className="line-clamp-2">{x.q}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
              <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-1.5 inline-flex items-center gap-1.5">
                <History size={13} /> {t("brain.ask.recent")}
              </p>
              {history.length ? (
                <div className="space-y-1">
                  {history.slice(0, 5).map((h) => (
                    <button key={h.id} onClick={() => openConversation(h.id)} className="w-full text-left truncate text-sm px-2 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                      {h.title}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-500 px-2">{t("brain.ask.noRecent")}</p>
              )}
              <p className="mt-3 text-[11px] text-neutral-500 px-2 leading-snug">{t("brain.ask.canUse")}</p>
            </section>
          </div>
        )}
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl bg-indigo-600 text-white px-3 py-2 text-sm whitespace-pre-wrap">
              {turn.content}
            </div>
          ) : (
            <Answer key={i} turn={turn} />
          )
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 size={13} className="animate-spin" /> {t("brain.ask.thinking")}
          </div>
        )}
      </div>
      <aside className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 h-fit">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-1">
          <History size={13} /> {t("brain.ask.history")}
          <button
            onClick={() => {
              setTurns([]);
              setConversationId(undefined);
            }}
            className="ml-auto text-indigo-600"
            title={t("brain.ask.new")}
          >
            <Plus size={13} />
          </button>
        </div>
        {history.map((h) => (
          <button key={h.id} onClick={() => openConversation(h.id)} className={cn("block w-full text-left truncate text-xs px-2 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800", h.id === conversationId && "bg-indigo-50 dark:bg-indigo-950/50")}>
            {h.title}
          </button>
        ))}
      </aside>
    </div>
  );
}

function Answer({ turn }: { turn: Turn }) {
  const { t } = useT();
  const sources = useMemo(() => turn.sources ?? [], [turn.sources]);
  // Turn [S3] into a link to source 3.
  const html = useMemo(() => {
    const base = markdownToHtml(turn.content);
    return base.replace(/\[S(\d{1,3})\]/g, (m, n) => {
      const s = sources.find((x) => x.n === Number(n));
      return s ? `<a class="brain-cite" href="#src-${n}" title="${s.title.replace(/"/g, "&quot;")}">[S${n}]</a>` : m;
    });
  }, [turn.content, sources]);
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4" data-testid="ask-answer">
      {!turn.grounded && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid="ask-ungrounded">
          <AlertTriangle size={12} /> {t("brain.ask.ungrounded")}
        </p>
      )}
      <div className="ai-md text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      {!!sources.length && (
        <div className="mt-3 border-t border-neutral-200 dark:border-neutral-800 pt-2" data-testid="ask-sources">
          <p className="text-[11px] font-semibold text-neutral-500 mb-1">{t("brain.ask.sources", { used: sources.filter((s) => s.used).length, total: sources.length })}</p>
          <ol className="space-y-1">
            {sources.map((s) => (
              <li key={s.n} id={`src-${s.n}`} className={cn("text-xs flex items-start gap-2 rounded-md px-1.5 py-1", s.used ? "bg-indigo-50/70 dark:bg-indigo-950/40" : "opacity-70")} data-testid="ask-source">
                <span className="font-mono text-[10px] text-indigo-600 shrink-0">S{s.n}</span>
                <span className="min-w-0 flex-1">
                  {s.href ? (
                    <Link href={s.href} className="font-medium hover:underline" target={s.href.startsWith("/api/") ? "_blank" : undefined}>
                      {s.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{s.title}</span>
                  )}
                  <Meta className="ml-2 align-middle">
                    <MetaChip>{t(`brain.entity.${s.type}` as MessageKey)}</MetaChip>
                    {s.status && <MetaStatus>{s.status}</MetaStatus>}
                    {s.historical && <MetaStatus className="bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">{t("brain.ask.historical")}</MetaStatus>}
                    {s.updatedAt && <span className="tabular-nums">{s.updatedAt.slice(0, 10)}</span>}
                  </Meta>
                  {s.snippet && <span className="block text-neutral-500 line-clamp-2">{s.snippet}</span>}
                </span>
                {s.used && <span className="text-[10px] text-indigo-600 shrink-0">{t("brain.ask.cited")}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
