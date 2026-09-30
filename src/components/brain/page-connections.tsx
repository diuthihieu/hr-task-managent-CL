"use client";
// Linked references for a wiki page (Obsidian-style): backlinks with the
// sentence that links here, unlinked mentions, outgoing links (broken ones
// flagged) and related pages - all derived from existing content.
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Link2Off, Loader2, Sparkles, TextSearch } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ENTITY_ICON } from "./link-picker";
import type { MessageKey } from "@/lib/i18n/core";

interface Mention {
  type: "wiki" | "task" | "decision";
  id: string;
  label: string;
  href?: string;
  sub?: string;
  context: string;
  blockId?: string;
}
interface Outgoing {
  target: string;
  type: keyof typeof ENTITY_ICON;
  text: string;
  label?: string;
  href?: string;
  sub?: string;
  blockId?: string;
  broken: boolean;
  blockMissing?: boolean;
}
interface Related {
  id: string;
  label: string;
  href?: string;
  sub?: string;
  reasons: string[];
}
export interface Connections {
  backlinks: Mention[];
  unlinked: Mention[];
  outgoing: Outgoing[];
  related: Related[];
}

export function PageConnections({ pageId, version, onLinkMention }: { pageId: string; version: string; onLinkMention?: (m: Mention) => void }) {
  const { t } = useT();
  const [data, setData] = useState<Connections | null>(null);
  const [tab, setTab] = useState<"backlinks" | "outgoing" | "related" | "unlinked">("backlinks");

  useEffect(() => {
    let cancelled = false;
    api
      .get<Connections>(`/api/wiki/${pageId}/connections`)
      .then((d) => !cancelled && setData(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pageId, version]);

  if (!data)
    return (
      <div className="mt-8 flex justify-center text-neutral-400">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  const broken = data.outgoing.filter((o) => o.broken || o.blockMissing).length;
  const tabs = [
    { key: "backlinks" as const, icon: ArrowDownLeft, n: data.backlinks.length },
    { key: "outgoing" as const, icon: ArrowUpRight, n: data.outgoing.length, warn: broken },
    { key: "related" as const, icon: Sparkles, n: data.related.length },
    { key: "unlinked" as const, icon: TextSearch, n: data.unlinked.length },
  ];
  const reason = (r: string) => (r.startsWith("#") ? r : r.startsWith("shared-links:") ? t("brain.related.sharedLinks", { n: r.split(":")[1] }) : t(`brain.related.${r}` as MessageKey));

  return (
    <section className="mt-10 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900" data-testid="page-connections">
      <div className="flex items-center gap-1 border-b border-neutral-200 dark:border-neutral-800 px-2 pt-2 overflow-x-auto thin-scroll">
        {tabs.map(({ key, icon: Icon, n, warn }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn("h-8 px-2.5 text-xs font-medium inline-flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap", tab === key ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200")}
            data-testid={`connections-tab-${key}`}
          >
            <Icon size={13} /> {t(`brain.conn.${key}` as MessageKey)}
            <span className="tabular-nums text-neutral-400">{n}</span>
            {!!warn && <span className="ml-0.5 px-1 rounded bg-red-50 text-red-600 dark:bg-red-950/60">{warn}</span>}
          </button>
        ))}
      </div>
      <div className="p-3 space-y-1.5 text-sm">
        {tab === "backlinks" &&
          (data.backlinks.length ? (
            data.backlinks.map((m, i) => <MentionRow key={`${m.type}${m.id}${i}`} m={m} t={t} testId="backlink" />)
          ) : (
            <Empty text={t("brain.conn.noBacklinks")} />
          ))}
        {tab === "unlinked" &&
          (data.unlinked.length ? (
            data.unlinked.map((m) => (
              <div key={m.id} className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <MentionRow m={m} t={t} testId="unlinked" />
                </div>
                {onLinkMention && (
                  <button onClick={() => onLinkMention(m)} className="shrink-0 text-xs text-indigo-600 hover:underline mt-1">
                    {t("brain.conn.openToLink")}
                  </button>
                )}
              </div>
            ))
          ) : (
            <Empty text={t("brain.conn.noUnlinked")} />
          ))}
        {tab === "outgoing" &&
          (data.outgoing.length ? (
            data.outgoing.map((o) => {
              const Icon = ENTITY_ICON[o.type] ?? Link2Off;
              const bad = o.broken || o.blockMissing;
              return (
                <div key={`${o.target}#${o.blockId ?? ""}`} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5", bad ? "bg-red-50/70 dark:bg-red-950/30" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60")} data-testid="outgoing-link">
                  {bad ? <AlertTriangle size={14} className="text-red-500 shrink-0" /> : <Icon size={14} className="text-neutral-500 shrink-0" />}
                  {o.href && !bad ? (
                    <Link href={o.href} className="truncate text-neutral-800 dark:text-neutral-100 hover:text-indigo-600">
                      {o.label ?? o.text}
                    </Link>
                  ) : (
                    <span className="truncate text-neutral-600 dark:text-neutral-300">{o.label ?? o.text}</span>
                  )}
                  {o.blockId && <span className="text-[10px] text-neutral-400">#{o.blockId}</span>}
                  <span className="ml-auto text-[11px] shrink-0 text-neutral-400">{bad ? <span className="text-red-600" data-testid="broken-link">{o.broken ? t("brain.conn.broken") : t("brain.conn.blockMissing")}</span> : (o.sub ?? t(`brain.entity.${o.type}` as MessageKey))}</span>
                </div>
              );
            })
          ) : (
            <Empty text={t("brain.conn.noOutgoing")} />
          ))}
        {tab === "related" &&
          (data.related.length ? (
            data.related.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60" data-testid="related-page">
                <ENTITY_ICON.wiki size={14} className="text-neutral-500 shrink-0" />
                <Link href={r.href ?? "#"} className="truncate text-neutral-800 dark:text-neutral-100 hover:text-indigo-600">
                  {r.label}
                </Link>
                <span className="ml-auto flex flex-wrap justify-end gap-1">
                  {r.reasons.slice(0, 3).map((x) => (
                    <span key={x} className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                      {reason(x)}
                    </span>
                  ))}
                </span>
              </div>
            ))
          ) : (
            <Empty text={t("brain.conn.noRelated")} />
          ))}
      </div>
    </section>
  );
}

function MentionRow({ m, t, testId }: { m: Mention; t: ReturnType<typeof useT>["t"]; testId: string }) {
  const Icon = ENTITY_ICON[m.type];
  return (
    <div className="rounded-lg px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60" data-testid={testId}>
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-neutral-500 shrink-0" />
        <Link href={m.href ?? "#"} className="truncate font-medium text-neutral-800 dark:text-neutral-100 hover:text-indigo-600">
          {m.label}
        </Link>
        {m.sub && <span className="text-[11px] text-neutral-400 truncate">{m.sub}</span>}
        {m.blockId && <span className="ml-auto text-[10px] text-neutral-400 shrink-0" title={t("brain.conn.blockLink")}>¶ {m.blockId}</span>}
      </div>
      {m.context && <p className="mt-0.5 pl-6 text-xs text-neutral-500 line-clamp-2">{m.context}</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-2 py-3 text-xs text-neutral-500">{text}</p>;
}
