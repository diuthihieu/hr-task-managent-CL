"use client";
// Picker for [[ ]] links and "Link to…": searches pages, meetings, tasks,
// projects, OKRs, people, decisions and files the user may see.
import { useEffect, useRef, useState } from "react";
import { BookOpen, CheckSquare, FolderKanban, Target, Crosshair, User, Gavel, Paperclip, CalendarDays, Loader2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";

export interface LinkTarget {
  type: "wiki" | "task" | "project" | "objective" | "kr" | "person" | "decision" | "file";
  id: string;
  label: string;
  sub?: string;
  kind?: string;
  status?: string;
  href: string;
}

export const ENTITY_ICON: Record<LinkTarget["type"], React.ComponentType<{ size?: number; className?: string }>> = {
  wiki: BookOpen,
  task: CheckSquare,
  project: FolderKanban,
  objective: Target,
  kr: Crosshair,
  person: User,
  decision: Gavel,
  file: Paperclip,
};

export function LinkPicker({
  workspaceId,
  onPick,
  onClose,
  types,
  position,
  initialQuery = "",
  autoFocus = true,
}: {
  workspaceId: string;
  onPick: (t: LinkTarget) => void;
  onClose: () => void;
  types?: LinkTarget["type"][];
  /** Viewport coordinates (fixed positioning); omitted = inline. */
  position?: { left: number; top: number };
  initialQuery?: string;
  autoFocus?: boolean;
}) {
  const { t } = useT();
  const [q, setQ] = useState(initialQuery);
  const [items, setItems] = useState<LinkTarget[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      api
        .get<{ items: LinkTarget[] }>(`/api/workspaces/${workspaceId}/brain/link-targets?q=${encodeURIComponent(q)}${types ? `&types=${types.join(",")}` : ""}`)
        .then((r) => {
          setItems(r.items);
          setActive(0);
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [q, workspaceId, types]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && onClose();
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const style: React.CSSProperties | undefined = position
    ? { position: "fixed", left: Math.min(position.left, window.innerWidth - 340), top: Math.min(position.top, window.innerHeight - 380), zIndex: 60 }
    : undefined;
  return (
    <div ref={box} style={style} className="w-80 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl p-1.5" data-testid="link-picker">
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && items[active]) {
            e.preventDefault();
            onPick(items[active]);
          }
        }}
        placeholder={t("brain.link.search")}
        className="h-8 w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-transparent px-2 text-sm outline-none focus:border-indigo-400"
        data-testid="link-picker-input"
      />
      <div className="max-h-72 overflow-y-auto thin-scroll mt-1">
        {loading && !items.length ? (
          <div className="py-4 flex justify-center text-neutral-400">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : !items.length ? (
          <p className="px-2 py-2 text-xs text-neutral-500">{t("brain.link.none")}</p>
        ) : (
          items.map((it, i) => {
            const Icon = it.type === "wiki" && it.kind === "meeting" ? CalendarDays : ENTITY_ICON[it.type];
            return (
              <button
                key={`${it.type}:${it.id}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(it)}
                className={cn("w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 text-sm", i === active ? "bg-indigo-50 dark:bg-indigo-950/60" : "hover:bg-neutral-100 dark:hover:bg-neutral-800")}
                data-testid="link-picker-item"
              >
                <Icon size={14} className="shrink-0 text-neutral-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-neutral-800 dark:text-neutral-100">{it.label}</span>
                  {it.sub && <span className="block truncate text-[11px] text-neutral-400">{it.sub}</span>}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-neutral-400 shrink-0">{t(`brain.entity.${it.type === "wiki" && it.kind === "meeting" ? "meeting" : it.type}` as MessageKey)}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
