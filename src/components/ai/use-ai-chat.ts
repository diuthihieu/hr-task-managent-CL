"use client";
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api-client";

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  content: string;
  pending?: boolean;
}
export interface ConversationLite {
  id: string;
  title: string;
  updatedAt: string;
}

type Target = { kind: "wiki"; wikiId: string } | { kind: "assistant"; workspaceId: string };

/** Chat state + streaming for the wiki assistant and the workspace AI assistant. */
export function useAiChat(target: Target) {
  const [conversations, setConversations] = useState<ConversationLite[]>([]);
  const [configured, setConfigured] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const qs = target.kind === "wiki" ? `kind=wiki&wikiId=${target.wikiId}` : `kind=assistant&workspaceId=${target.workspaceId}`;

  const loadConversations = useCallback(async () => {
    const r = await api.get<{ configured: boolean; items: ConversationLite[] }>(`/api/ai/conversations?${qs}`);
    setConfigured(r.configured);
    setConversations(r.items);
    return r.items;
  }, [qs]);

  const open = useCallback(async (id: string | null) => {
    abortRef.current?.abort();
    setError(null);
    setConversationId(id);
    if (!id) {
      setMessages([]);
      return;
    }
    const r = await api.get<{ messages: ChatMessage[] }>(`/api/ai/conversations/${id}`);
    setMessages(r.messages);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await api.delete(`/api/ai/conversations/${id}`);
      if (id === conversationId) open(null);
      loadConversations();
    },
    [conversationId, open, loadConversations]
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setError(null);
      setBusy(true);
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: message };
      const botId = `m-${Date.now()}`;
      setMessages((prev) => [...prev, userMsg, { id: botId, role: "model", content: "", pending: true }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...target, conversationId: conversationId ?? undefined, message }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const newId = res.headers.get("X-Conversation-Id");
        if (newId && newId !== conversationId) setConversationId(newId);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, content: acc } : m)));
        }
        setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, pending: false } : m)));
        loadConversations().catch(() => {});
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed");
        setMessages((prev) => prev.filter((m) => m.id !== botId));
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- target is a fresh object each render; its identity is captured by qs
    [busy, conversationId, qs, loadConversations]
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { conversations, configured, conversationId, messages, busy, error, loadConversations, open, remove, send, stop };
}
