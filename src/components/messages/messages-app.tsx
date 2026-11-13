"use client";
// Messages: conversation list + thread, contacts, new group, group settings. Live through
// useChatSignals (Supabase Realtime, or polling); every read goes through /api/messages.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, Check, CheckCheck, Download, Hash, Loader2, MoreHorizontal, Plus, Search, Send, Settings2, Users, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn, initials } from "@/lib/utils";
import { chatChanged, useChatLive, useChatSignals } from "./use-chat-live";
import { Markdown } from "@/components/ai/markdown";

interface PersonLite {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
}
interface ConversationRow {
  id: string;
  kind: "direct" | "group" | "bot";
  name: string | null;
  members: (PersonLite & { gone: boolean })[];
  isAdmin: boolean;
  muted: boolean;
  lastMessageAt: string;
  unread: number;
  last: { body: string | null; recalled: boolean; author: string | null; at: string } | null;
}
type TaskTag = { id: string; title: string; project: string; projectId: string; workspaceSlug: string; status: string; done: boolean } | { id: string; hidden: true };
interface Msg {
  id: string;
  author: { id: string; name: string; avatarColor: string } | null;
  mine: boolean;
  body: string;
  recalled: boolean;
  edited: boolean;
  createdAt: string;
  tasks: TaskTag[];
  outputs: { id: string; filename: string; type: string }[];
}
interface Page {
  more: boolean;
  otherReadAt: string | null;
  messages: Msg[];
}

const EDIT_WINDOW_MS = 60 * 60_000;

function Avatar({ name, color, size = 32, bot }: { name: string; color?: string; size?: number; bot?: boolean }) {
  return (
    <span className="shrink-0 rounded-full flex items-center justify-center text-white text-[11px] font-semibold" style={{ width: size, height: size, background: bot ? "linear-gradient(135deg,#6366f1,#a855f7)" : color || "#64748b" }} aria-hidden>
      {bot ? <Bot size={size * 0.5} /> : initials(name)}
    </span>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });

export function MessagesApp({ meId, initialConversationId, initialTab }: { meId: string; initialConversationId: string | null; initialTab: "chats" | "contacts" }) {
  const { t } = useT();
  const router = useRouter();
  const live = useChatLive();
  const [tab, setTab] = useState<"chats" | "contacts">(initialTab);
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [active, setActive] = useState<string | null>(initialConversationId);
  const [newGroup, setNewGroup] = useState(false);

  const load = useCallback(() => {
    api.get<ConversationRow[]>("/api/messages").then(setRows).catch((e) => toast.error(e instanceof Error ? e.message : t("common.failed")));
  }, [t]);
  useEffect(() => load(), [load]);
  useChatSignals((s) => {
    if (s.event === "message" || s.event === "conversation" || s.event === "poll" || s.event === "read") load();
  });

  const open = useCallback(
    (id: string) => {
      setActive(id);
      setTab("chats");
      router.replace(`?c=${id}`, { scroll: false });
    },
    [router],
  );
  const openDirect = useCallback(
    async (userId: string) => {
      try {
        const r = await api.post<{ id: string }>("/api/messages", { kind: "direct", userId });
        load();
        open(r.id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("common.failed"));
      }
    },
    [load, open, t],
  );

  const current = rows?.find((r) => r.id === active) ?? null;
  const title = (c: ConversationRow) => (c.kind === "bot" ? t("chat.bot") : c.kind === "group" ? c.name || c.members.map((m) => m.name).join(", ") : (c.name ?? "?"));

  return (
    <div className="flex h-full min-h-0 bg-white dark:bg-neutral-950" data-testid="messages-app">
      <aside className={cn("w-full md:w-80 shrink-0 border-r border-neutral-200 dark:border-neutral-800 flex flex-col min-h-0", active && "hidden md:flex")}>
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <h1 className="text-lg font-semibold">{t("chat.title")}</h1>
          <Button size="sm" variant="outline" onClick={() => setNewGroup(true)} data-testid="chat-new-group">
            <Users size={14} /> {t("chat.newGroup")}
          </Button>
        </div>
        <div className="px-4 flex gap-1 border-b border-neutral-200 dark:border-neutral-800" role="tablist">
          {(["chats", "contacts"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-9 px-3 text-xs font-medium border-b-2", tab === k ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-neutral-500")} data-testid={`chat-tab-${k}`}>
              {t(k === "chats" ? "chat.tab.chats" : "chat.tab.contacts")}
            </button>
          ))}
        </div>
        {!live && <p className="px-4 py-1.5 text-[11px] text-neutral-400" data-testid="chat-offline">{t("chat.offline")}</p>}
        <div className="flex-1 overflow-y-auto thin-scroll">
          {tab === "contacts" ? (
            <ContactsPanel onMessage={openDirect} />
          ) : rows === null ? (
            <div className="p-6 flex justify-center text-neutral-400"><Loader2 className="animate-spin" size={18} /></div>
          ) : (
            <ul className="py-1" data-testid="chat-list">
              {rows.map((c) => (
                <li key={c.id}>
                  <button onClick={() => open(c.id)} className={cn("w-full text-left px-4 py-2.5 flex gap-3 items-center hover:bg-neutral-50 dark:hover:bg-neutral-900", active === c.id && "bg-indigo-50 dark:bg-indigo-950/40")} data-testid={`chat-row-${c.kind}`}>
                    {c.kind === "group" ? <span className="h-9 w-9 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 flex items-center justify-center shrink-0"><Users size={16} /></span> : <Avatar name={title(c)} color={c.members[0]?.avatarColor} size={36} bot={c.kind === "bot"} />}
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline gap-2">
                        <span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{title(c)}</span>
                        {c.last && <span className="ml-auto text-[10px] text-neutral-400 shrink-0">{time(c.last.at)}</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs text-neutral-500">{c.last ? `${c.last.author ? `${c.last.author}: ` : c.kind === "bot" ? "" : `${t("chat.you")}: `}${c.last.recalled ? t("chat.recalled") : c.last.body}` : c.kind === "bot" ? t("chat.botHint") : ""}</span>
                        {c.unread > 0 && <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-semibold leading-5 text-center shrink-0">{c.unread}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {rows.length <= 1 && <li className="px-4 py-6 text-xs text-neutral-500">{t("chat.empty")}</li>}
            </ul>
          )}
        </div>
        <p className="px-4 py-2 text-[10px] text-neutral-400 border-t border-neutral-100 dark:border-neutral-900">{t("chat.notEncrypted")}</p>
      </aside>
      <section className={cn("flex-1 min-w-0 flex flex-col min-h-0", !active && "hidden md:flex")}>
        {current ? (
          <Thread key={current.id} meId={meId} conversation={current} title={title(current)} onBack={() => { setActive(null); router.replace("?", { scroll: false }); }} onChanged={load} onLeft={() => { setActive(null); load(); }} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-neutral-400">{rows && active ? <Loader2 className="animate-spin" size={18} /> : t("chat.pick")}</div>
        )}
      </section>
      {newGroup && <NewGroupDialog onClose={() => setNewGroup(false)} onCreated={(id) => { setNewGroup(false); load(); open(id); }} />}
    </div>
  );
}

function Thread({ meId, conversation, title, onBack, onChanged, onLeft }: { meId: string; conversation: ConversationRow; title: string; onBack: () => void; onChanged: () => void; onLeft: () => void }) {
  const { t } = useT();
  const id = conversation.id;
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [more, setMore] = useState(false);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [settings, setSettings] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stick = useRef(true);
  // Edit / recall stay offered for an hour; re-checked every half minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(h);
  }, []);

  const markRead = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    api.post(`/api/messages/${id}/read`).then(() => chatChanged()).catch(() => {});
  }, [id]);

  /** The latest page, merged into what is loaded; `read` false for a read receipt (never answer one with another). */
  const loadLatest = useCallback((read = true) => {
    return api.get<Page>(`/api/messages/${id}`).then((p) => {
      setMsgs((prev) => {
        if (!prev) {
          setMore(p.more);
          return p.messages;
        }
        // Merge: keep older pages, replace / add the latest ones (edits and recalls included).
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of p.messages) byId.set(m.id, m);
        return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
      setOtherReadAt(p.otherReadAt);
      if (read) markRead();
    }, (e: unknown) => toast.error(e instanceof Error ? e.message : t("common.failed")));
  }, [id, markRead, t]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);
  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  /** Re-read messages already on screen (an edit or recall of one older than the latest page). */
  const refresh = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      api.get<Page>(`/api/messages/${id}?ids=${ids.join(",")}`).then((p) => {
        const fresh = new Map(p.messages.map((m) => [m.id, m]));
        setMsgs((prev) => prev && prev.map((m) => fresh.get(m.id) ?? m));
      }, () => {});
    },
    [id],
  );

  useChatSignals((s) => {
    if (s.event === "poll" || (s.event === "message" && s.payload.c === id)) void loadLatest();
    if (s.event === "read" && s.payload.c === id) void loadLatest(false);
    if (s.event === "message" && s.payload.c === id && typeof s.payload.m === "string") refresh([s.payload.m]);
    if (s.event === "typing" && s.payload.c === id && s.payload.u !== meId) {
      setTypingName(String(s.payload.n ?? ""));
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTypingName(null), 4000);
    }
    if (s.event === "message" && s.payload.c === id) setTypingName(null);
  });

  async function loadOlder() {
    if (!msgs?.length) return;
    stick.current = false;
    const p = await api.get<Page>(`/api/messages/${id}?before=${encodeURIComponent(msgs[0].createdAt)}`);
    setMore(p.more);
    setMsgs((prev) => [...p.messages, ...(prev ?? [])]);
  }

  async function recall(m: Msg) {
    if (!confirm(t("chat.recallConfirm"))) return;
    try {
      await api.delete(`/api/messages/items/${m.id}`);
      await loadLatest();
      refresh([m.id]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  const lastMineSeen = useMemo(() => {
    if (conversation.kind !== "direct" || !otherReadAt || !msgs) return null;
    const mine = msgs.filter((m) => m.mine && !m.recalled);
    const seen = mine.filter((m) => m.createdAt <= otherReadAt);
    return seen.length ? seen[seen.length - 1].id : null;
  }, [conversation.kind, otherReadAt, msgs]);

  const canWrite = conversation.kind !== "bot";
  return (
    <>
      <header className="h-14 shrink-0 px-3 md:px-5 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-3">
        <button className="md:hidden p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={onBack} aria-label={t("chat.back")}><ArrowLeft size={18} /></button>
        {conversation.kind === "group" ? <span className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 flex items-center justify-center"><Users size={15} /></span> : <Avatar name={title} color={conversation.members[0]?.avatarColor} bot={conversation.kind === "bot"} />}
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate" data-testid="chat-thread-title">{title}</p>
          <p className="text-[11px] text-neutral-500 truncate">{conversation.kind === "group" ? t("chat.members", { count: conversation.members.length + 1 }) : conversation.kind === "bot" ? t("chat.botHint") : conversation.members[0]?.email}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t("chat.manage")} data-testid="chat-thread-menu"><MoreHorizontal size={18} /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => api.patch(`/api/messages/${id}`, { muted: !conversation.muted }).then(onChanged).catch((e) => toast.error(e.message))}>{t(conversation.muted ? "chat.unmute" : "chat.mute")}</DropdownMenuItem>
            {conversation.kind === "group" && (
              <>
                <DropdownMenuItem onSelect={() => setSettings(true)} data-testid="chat-group-settings"><Settings2 size={14} /> {t("chat.manage")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => confirm(t("chat.leaveConfirm")) && api.patch(`/api/messages/${id}`, { leave: true }).then(onLeft).catch((e) => toast.error(e.message))} className="text-rose-600" data-testid="chat-leave">{t("chat.leave")}</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="flex-1 overflow-y-auto thin-scroll px-3 md:px-6 py-4 space-y-1" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} data-testid="chat-messages">
        {more && (
          <div className="flex justify-center pb-2">
            <Button size="sm" variant="ghost" onClick={() => void loadOlder()}>{t("chat.older")}</Button>
          </div>
        )}
        {msgs === null ? (
          <div className="flex justify-center py-8 text-neutral-400"><Loader2 className="animate-spin" size={18} /></div>
        ) : (
          msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
            const sameAuthor = prev && !newDay && prev.author?.id === m.author?.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
            const changeable = m.mine && !m.recalled && now - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
            return (
              <div key={m.id}>
                {newDay && <p className="text-center text-[10px] text-neutral-400 py-2">{dayLabel(m.createdAt)}</p>}
                <div className={cn("group flex gap-2", m.mine ? "justify-end" : "justify-start", !sameAuthor && "pt-2")} data-testid="chat-message">
                  {!m.mine && <span className="w-7">{!sameAuthor && <Avatar name={m.author?.name ?? "Woli AI"} color={m.author?.avatarColor} size={28} bot={!m.author} />}</span>}
                  <div className={cn("flex flex-col min-w-0", m.author || m.mine ? "max-w-[78%]" : "max-w-[92%]", m.mine ? "items-end" : "items-start")}>
                    {!m.mine && !sameAuthor && conversation.kind === "group" && <span className="text-[11px] text-neutral-500 mb-0.5">{m.author?.name}</span>}
                    <div className="flex items-center gap-1">
                      {changeable && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t("chat.edit")} data-testid="chat-message-menu"><MoreHorizontal size={14} /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(m)} data-testid="chat-edit">{t("chat.edit")}</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void recall(m)} className="text-rose-600" data-testid="chat-recall">{t("chat.recall")}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      <div className={cn("rounded-2xl px-3 py-2 text-sm break-words", m.author && "whitespace-pre-wrap", !m.author && !m.mine && "min-w-0 max-w-full overflow-x-auto", m.recalled ? "italic text-neutral-400 border border-dashed border-neutral-300 dark:border-neutral-700" : m.mine ? "bg-indigo-600 text-white" : "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100")} data-testid="chat-bubble">
                        {m.recalled ? t("chat.recalled") : m.author ? m.body : <Markdown text={m.body} className="text-sm" />}
                      </div>
                    </div>
                    {m.tasks.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {m.tasks.map((tag) =>
                          "hidden" in tag ? (
                            <span key={tag.id} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400" data-testid="chat-task-hidden"><Hash size={11} />{t("chat.taskHidden")}</span>
                          ) : (
                            <Link key={tag.id} href={`/w/${tag.workspaceSlug}/p/${tag.projectId}/t/${tag.id}`} className="inline-flex items-center gap-1 rounded-md border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[11px] text-indigo-700 dark:text-indigo-300 hover:border-indigo-400 max-w-64" title={`${tag.project} - ${tag.status}`} data-testid="chat-task">
                              {tag.done ? <Check size={11} /> : <Hash size={11} />}
                              <span className="truncate">{tag.title}</span>
                            </Link>
                          ),
                        )}
                      </div>
                    )}
                    {m.outputs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {m.outputs.map((o) => (
                          <a key={o.id} href={`/api/agent-work/outputs/${o.id}/download`} className="inline-flex items-center gap-1 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-[11px] hover:border-indigo-400"><Download size={11} />{o.filename}</a>
                        ))}
                      </div>
                    )}
                    <span className="text-[10px] text-neutral-400 mt-0.5 flex items-center gap-1">
                      {time(m.createdAt)}
                      {m.edited && !m.recalled && <span>· {t("chat.edited")}</span>}
                      {lastMineSeen === m.id && <span className="flex items-center gap-0.5 text-indigo-500" data-testid="chat-seen"><CheckCheck size={11} />{t("chat.seen")}</span>}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {typingName && <p className="text-[11px] text-neutral-400 pl-9" data-testid="chat-typing">{t("chat.typing", { name: typingName })}</p>}
        <div ref={endRef} />
      </div>
      {canWrite ? (
        <Composer key={editing?.id ?? "new"} conversationId={id} editing={editing} onCancelEdit={() => setEditing(null)} onSent={() => { stick.current = !editing; if (editing) refresh([editing.id]); setEditing(null); void loadLatest(); onChanged(); }} />
      ) : (
        <p className="px-5 py-3 text-xs text-neutral-500 border-t border-neutral-200 dark:border-neutral-800">{t("chat.botReadOnly")}</p>
      )}
      {settings && <GroupSettingsDialog meId={meId} conversation={conversation} onClose={() => setSettings(false)} onChanged={onChanged} />}
    </>
  );
}

interface TaskOption {
  id: string;
  title: string;
  project: string;
  workspace: string;
}

function Composer({ conversationId, editing, onCancelEdit, onSent }: { conversationId: string; editing: Msg | null; onCancelEdit: () => void; onSent: () => void }) {
  const { t } = useT();
  // Editing a message remounts the composer (key) with that message in it.
  const [text, setText] = useState(editing?.body ?? "");
  const [tags, setTags] = useState<{ id: string; title: string }[]>(() => (editing?.tasks ?? []).filter((x): x is Exclude<TaskTag, { hidden: true }> => !("hidden" in x)).map((x) => ({ id: x.id, title: x.title })));
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<TaskOption[] | null>(null);
  const [activeOpt, setActiveOpt] = useState(0);
  const lastTyping = useRef(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const hashQuery = /(?:^|\s)#([^\s#]*)$/.exec(text)?.[1] ?? null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const options = hashQuery !== null && dismissed !== hashQuery ? found : null;
  useEffect(() => {
    if (hashQuery === null) return;
    const h = setTimeout(() => {
      api.get<TaskOption[]>(`/api/messages/tasks?q=${encodeURIComponent(hashQuery)}`).then((r) => { setFound(r); setActiveOpt(0); }).catch(() => setFound([]));
    }, 200);
    return () => clearTimeout(h);
  }, [hashQuery]);

  function pickTask(o: TaskOption) {
    setTags((prev) => (prev.some((x) => x.id === o.id) || prev.length >= 10 ? prev : [...prev, { id: o.id, title: o.title }]));
    setText((s) => s.replace(/#([^\s#]*)$/, "").replace(/\s+$/, s.endsWith(" ") ? " " : ""));
    setFound(null);
    ref.current?.focus();
  }

  function onChange(v: string) {
    setText(v);
    const now = Date.now();
    if (!editing && v.trim() && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      api.post(`/api/messages/${conversationId}/typing`).catch(() => {});
    }
  }

  async function submit() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      if (editing) await api.patch(`/api/messages/items/${editing.id}`, { body, taskIds: tags.map((x) => x.id) });
      else await api.post(`/api/messages/${conversationId}`, { body, taskIds: tags.map((x) => x.id) });
      setText("");
      setTags([]);
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-neutral-200 dark:border-neutral-800 px-3 md:px-5 py-3 relative">
      {options && (
        <div role="listbox" className="absolute bottom-full left-3 right-3 md:left-5 md:right-5 mb-1 max-h-64 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg p-1 z-20" data-testid="chat-task-picker">
          <p className="px-2 py-1 text-[11px] font-medium text-neutral-500">{t("chat.tagTask")}</p>
          {options.length === 0 ? (
            <p className="px-2 py-2 text-xs text-neutral-400">{t("chat.noTasks")}</p>
          ) : (
            options.map((o, i) => (
              <button key={o.id} type="button" role="option" aria-selected={i === activeOpt} onMouseDown={(e) => e.preventDefault()} onClick={() => pickTask(o)} className={cn("w-full text-left rounded-lg px-2 py-1.5", i === activeOpt && "bg-indigo-50 dark:bg-indigo-950/50")} data-testid="chat-task-option">
                <span className="block text-sm truncate">{o.title}</span>
                <span className="block text-[11px] text-neutral-500 truncate">{o.workspace} - {o.project}</span>
              </button>
            ))
          )}
        </div>
      )}
      {editing && (
        <div className="flex items-center gap-2 mb-1.5 text-[11px] text-indigo-600">
          <span>{t("chat.edit")}</span>
          <button onClick={() => { setText(""); setTags([]); onCancelEdit(); }} className="ml-auto text-neutral-400 hover:text-neutral-600" aria-label={t("common.cancel")}><X size={13} /></button>
        </div>
      )}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {tags.map((tag) => (
            <span key={tag.id} className="inline-flex items-center gap-1 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-[11px] max-w-64" data-testid="chat-tag-chip">
              <Hash size={11} /><span className="truncate">{tag.title}</span>
              <button onClick={() => setTags((p) => p.filter((x) => x.id !== tag.id))} aria-label={t("common.remove")}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-2xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 focus-within:border-indigo-400">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (options?.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setActiveOpt((a) => (a + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
              return;
            }
            if (options?.length && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              pickTask(options[activeOpt]);
              return;
            }
            if (e.key === "Escape" && options) {
              setDismissed(hashQuery);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={t("chat.placeholder")}
          className="flex-1 resize-none bg-transparent outline-none text-sm max-h-40"
          data-testid="chat-input"
        />
        <button onClick={() => void submit()} disabled={!text.trim() || busy} className="h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 disabled:opacity-40" aria-label={t("chat.send")} data-testid="chat-send">
          {busy ? <Loader2 size={14} className="animate-spin" /> : editing ? <Check size={15} /> : <Send size={14} />}
        </button>
      </div>
      <p className="text-[10px] text-neutral-400 mt-1">{t("chat.editWindow")}</p>
    </div>
  );
}

type PersonStatus = PersonLite & { status: "none" | "friend" | "incoming" | "outgoing" | "blocked" };

function ContactsPanel({ onMessage }: { onMessage: (userId: string) => void }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PersonStatus[] | null>(null);
  const found = q.trim() ? results : null;
  const [lists, setLists] = useState<{ friends: PersonLite[]; incoming: PersonLite[]; outgoing: PersonLite[]; blocked: PersonLite[] } | null>(null);
  const load = useCallback(() => {
    api.get<typeof lists & object>("/api/messages/contacts").then(setLists).catch(() => {});
  }, []);
  useEffect(() => load(), [load]);
  useChatSignals((s) => {
    if (s.event === "contact" || s.event === "poll") load();
  });
  useEffect(() => {
    if (!q.trim()) return;
    const h = setTimeout(() => api.get<PersonStatus[]>(`/api/messages/people?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(h);
  }, [q]);

  async function act(userId: string, action: "accept" | "decline" | "remove" | "block" | "unblock" | "request") {
    try {
      if (action === "request") await api.post("/api/messages/contacts", { userId });
      else await api.patch(`/api/messages/contacts/${userId}`, { action });
      load();
      if (q.trim()) setResults(await api.get<PersonStatus[]>(`/api/messages/people?q=${encodeURIComponent(q)}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  const row = (p: PersonLite, actions: React.ReactNode, testId: string) => (
    <li key={p.id} className="px-4 py-2 flex items-center gap-3" data-testid={testId}>
      <Avatar name={p.name} color={p.avatarColor} />
      <span className="flex-1 min-w-0">
        <span className="block text-sm truncate">{p.name}</span>
        <span className="block text-[11px] text-neutral-500 truncate">{p.email}</span>
      </span>
      <span className="flex gap-1 shrink-0">{actions}</span>
    </li>
  );
  const more = (p: PersonLite, extra: React.ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="…"><MoreHorizontal size={15} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {extra}
        <DropdownMenuItem onSelect={() => void act(p.id, "block")} className="text-rose-600">{t("chat.block")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const section = (key: "chat.friends" | "chat.incoming" | "chat.outgoing" | "chat.blocked", items: PersonLite[] | undefined, render: (p: PersonLite) => React.ReactNode) =>
    items && items.length > 0 ? (
      <div>
        <p className="px-4 pt-3 pb-1 text-[11px] font-medium text-neutral-500 uppercase tracking-wide">{t(key)} ({items.length})</p>
        <ul>{items.map(render)}</ul>
      </div>
    ) : null;

  return (
    <div className="pb-4" data-testid="chat-contacts">
      <div className="px-4 pt-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("chat.search")} className="pl-8 h-9 text-sm" data-testid="chat-people-search" />
        </div>
        <p className="text-[10px] text-neutral-400 mt-1">{t("chat.searchHint")}</p>
      </div>
      {found ? (
        <ul className="pt-1" data-testid="chat-people-results">
          {found.map((p) =>
            row(
              p,
              p.status === "friend" ? (
                <Button size="sm" variant="outline" onClick={() => onMessage(p.id)}>{t("chat.message")}</Button>
              ) : p.status === "incoming" ? (
                <Button size="sm" onClick={() => void act(p.id, "accept")}>{t("chat.accept")}</Button>
              ) : p.status === "outgoing" ? (
                <span className="text-[11px] text-neutral-500 px-1">{t("chat.pending")}</span>
              ) : p.status === "blocked" ? (
                <Button size="sm" variant="ghost" onClick={() => void act(p.id, "unblock")}>{t("chat.unblock")}</Button>
              ) : (
                <Button size="sm" onClick={() => void act(p.id, "request")} data-testid="chat-add-contact"><Plus size={12} /> {t("chat.add")}</Button>
              ),
              "chat-person",
            ),
          )}
        </ul>
      ) : (
        <>
          {section("chat.incoming", lists?.incoming, (p) => row(p, <><Button size="sm" onClick={() => void act(p.id, "accept")} data-testid="chat-accept">{t("chat.accept")}</Button><Button size="sm" variant="ghost" onClick={() => void act(p.id, "decline")}>{t("chat.decline")}</Button></>, "chat-incoming"))}
          {section("chat.friends", lists?.friends, (p) => row(p, <><Button size="sm" variant="outline" onClick={() => onMessage(p.id)} data-testid="chat-message-friend">{t("chat.message")}</Button>{more(p, <DropdownMenuItem onSelect={() => void act(p.id, "remove")}>{t("chat.unfriend")}</DropdownMenuItem>)}</>, "chat-friend"))}
          {section("chat.outgoing", lists?.outgoing, (p) => row(p, <Button size="sm" variant="ghost" onClick={() => void act(p.id, "remove")}>{t("chat.cancel")}</Button>, "chat-outgoing"))}
          {section("chat.blocked", lists?.blocked, (p) => row(p, <Button size="sm" variant="ghost" onClick={() => void act(p.id, "unblock")}>{t("chat.unblock")}</Button>, "chat-blocked"))}
          {lists && !lists.friends.length && !lists.incoming.length && !lists.outgoing.length && <p className="px-4 py-6 text-xs text-neutral-500">{t("chat.noContacts")}</p>}
        </>
      )}
    </div>
  );
}

/** Pick people sharing a workspace with me (search as you type). */
function PeoplePicker({ selected, onToggle, exclude = [] }: { selected: PersonLite[]; onToggle: (p: PersonLite) => void; exclude?: string[] }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<PersonStatus[]>([]);
  useEffect(() => {
    const h = setTimeout(() => api.get<PersonStatus[]>(`/api/messages/people?q=${encodeURIComponent(q)}`).then(setFound).catch(() => setFound([])), 200);
    return () => clearTimeout(h);
  }, [q]);
  const visible = found.filter((p) => p.status !== "blocked" && !exclude.includes(p.id));
  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 pl-2 pr-1 py-0.5 text-xs">
              {p.name}
              <button onClick={() => onToggle(p)} aria-label={t("common.remove")}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("chat.search")} className="h-9 text-sm" data-testid="chat-picker-search" />
      <ul className="max-h-56 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        {visible.map((p) => {
          const on = selected.some((s) => s.id === p.id);
          return (
            <li key={p.id}>
              <button type="button" onClick={() => onToggle(p)} className={cn("w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm", on && "bg-indigo-50 dark:bg-indigo-950/40")} data-testid="chat-picker-person">
                <Avatar name={p.name} color={p.avatarColor} size={24} />
                <span className="flex-1 min-w-0 truncate">{p.name} <span className="text-[11px] text-neutral-500">- {p.email}</span></span>
                {on && <Check size={14} className="text-indigo-600" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NewGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<PersonLite[]>([]);
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const r = await api.post<{ id: string }>("/api/messages", { kind: "group", name: name.trim(), memberIds: members.map((m) => m.id) });
      onCreated(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="chat-new-group-dialog">
        <DialogTitle>{t("chat.newGroup")}</DialogTitle>
        <div className="space-y-3 mt-3">
          <label className="block text-xs font-medium space-y-1">
            <span>{t("chat.groupName")}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="chat-group-name" />
          </label>
          <div className="text-xs font-medium space-y-1">
            <span>{t("chat.groupMembers")}</span>
            <PeoplePicker selected={members} onToggle={(p) => setMembers((m) => (m.some((x) => x.id === p.id) ? m.filter((x) => x.id !== p.id) : [...m, p]))} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => void create()} disabled={busy || !name.trim() || !members.length} data-testid="chat-group-create">{busy && <Loader2 size={14} className="animate-spin" />}{t("chat.create")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupSettingsDialog({ meId, conversation, onClose, onChanged }: { meId: string; conversation: ConversationRow; onClose: () => void; onChanged: () => void }) {
  const { t } = useT();
  const [name, setName] = useState(conversation.name ?? "");
  const [add, setAdd] = useState<PersonLite[]>([]);
  const [busy, setBusy] = useState(false);
  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api.patch(`/api/messages/${conversation.id}`, body);
      onChanged();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="chat-group-settings-dialog">
        <DialogTitle>{t("chat.manage")}</DialogTitle>
        {conversation.isAdmin ? (
          <div className="space-y-4 mt-3">
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label={t("chat.groupName")} />
              <Button variant="outline" disabled={busy || !name.trim() || name === conversation.name} onClick={() => void patch({ name })}>{t("chat.rename")}</Button>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium">{t("chat.members", { count: conversation.members.length + 1 })}</p>
              <ul className="max-h-40 overflow-y-auto">
                {conversation.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 py-1 text-sm">
                    <Avatar name={m.name} color={m.avatarColor} size={22} />
                    <span className="flex-1 truncate">{m.name}</span>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void patch({ remove: [m.id] })}>{t("chat.remove")}</Button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium">{t("chat.addMembers")}</p>
              <PeoplePicker selected={add} exclude={[meId, ...conversation.members.map((m) => m.id)]} onToggle={(p) => setAdd((a) => (a.some((x) => x.id === p.id) ? a.filter((x) => x.id !== p.id) : [...a, p]))} />
              <div className="flex justify-end">
                <Button size="sm" disabled={busy || !add.length} onClick={() => void patch({ add: add.map((p) => p.id) }).then((ok) => ok && setAdd([]))} data-testid="chat-group-add">{t("chat.addMembers")}</Button>
              </div>
            </div>
          </div>
        ) : (
          <ul className="mt-3 max-h-60 overflow-y-auto">
            {conversation.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-1 text-sm"><Avatar name={m.name} color={m.avatarColor} size={22} />{m.name}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-end mt-4">
          <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
