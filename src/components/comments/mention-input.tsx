"use client";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AtSign, Bold, Italic, List, Code, Link2 } from "lucide-react";
import { markdownToHtml } from "@/components/ai/markdown";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn, initials } from "@/lib/utils";
import { mentionToken, MENTION_RE } from "@/lib/mentions";
import { AvatarImg } from "@/components/ui/avatar-img";

interface Person {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
}

const peopleCache = new Map<string, Promise<Person[]>>();
function loadPeople(url: string) {
  if (!peopleCache.has(url)) peopleCache.set(url, api.get<Person[]>(url).catch(() => []));
  return peopleCache.get(url)!;
}

export interface MentionInputHandle {
  focus: () => void;
}

/**
 * Comment box with @mentions: type "@" (or press the @ button) to pick a
 * person who can see the task. Stored as @[Name](id); shown as a chip.
 */
export const MentionInput = forwardRef<MentionInputHandle, {
  /** People who can see this task are offered for @mentions... */
  taskId?: string;
  /** ...or any endpoint returning Person[] (e.g. a wiki page's readers). */
  mentionUrl?: string;
  /** Show a Markdown formatting toolbar (bold, italic, list, code, link). */
  formatting?: boolean;
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  testId?: string;
}>(function MentionInput({ taskId, mentionUrl, formatting, value, onChange, onSubmit, placeholder, rows = 2, className, testId }, ref) {
  const peopleUrl = mentionUrl ?? (taskId ? `/api/tasks/${taskId}/mentionable` : "");
  const { t } = useT();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [anchor, setAnchor] = useState(0);
  const [active, setActive] = useState(0);

  useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus() }));
  useEffect(() => {
    let alive = true;
    if (peopleUrl) loadPeople(peopleUrl).then((p) => alive && setPeople(p));
    return () => {
      alive = false;
    };
  }, [peopleUrl]);

  /** Wrap the selection (or insert a placeholder) with Markdown syntax. */
  function wrap(before: string, after = before, placeholder = "text") {
    const ta = taRef.current;
    const a = ta?.selectionStart ?? value.length;
    const b = ta?.selectionEnd ?? value.length;
    const sel = value.slice(a, b) || placeholder;
    onChange(value.slice(0, a) + before + sel + after + value.slice(b));
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(a + before.length, a + before.length + sel.length);
    });
  }
  function format(kind: "bold" | "italic" | "list" | "code" | "link") {
    if (kind === "bold") wrap("**");
    else if (kind === "italic") wrap("_");
    else if (kind === "list") linePrefix("- ");
    else if (kind === "code") wrap("`");
    else wrap("[", "](https://)", "link");
  }
  function linePrefix(prefix: string) {
    const ta = taRef.current;
    const a = ta?.selectionStart ?? value.length;
    const start = value.lastIndexOf("\n", a - 1) + 1;
    onChange(value.slice(0, start) + prefix + value.slice(start));
    requestAnimationFrame(() => ta?.focus());
  }

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)).slice(0, 6);
  }, [people, query]);

  function detect(text: string, caret: number) {
    const before = text.slice(0, caret);
    const m = before.match(/(^|\s)@([^\s@[\]()]{0,30})$/);
    if (m) {
      setQuery(m[2]);
      setAnchor(caret - m[2].length - 1);
      setActive(0);
    } else setQuery(null);
  }

  function pick(p: Person) {
    const caret = taRef.current?.selectionStart ?? value.length;
    const token = mentionToken(p.name, p.id) + " ";
    const next = value.slice(0, anchor) + token + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = anchor + token.length;
      taRef.current?.focus();
      taRef.current?.setSelectionRange(pos, pos);
    });
  }

  function openPicker() {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? value.length;
    const needsSpace = caret > 0 && !/\s/.test(value[caret - 1]);
    const next = value.slice(0, caret) + (needsSpace ? " @" : "@") + value.slice(caret);
    onChange(next);
    const at = caret + (needsSpace ? 1 : 0);
    setAnchor(at);
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(at + 1, at + 1);
    });
  }

  return (
    <div className={cn("relative flex-1", className)}>
      {formatting && (
        <div className="flex items-center gap-0.5 mb-1" data-testid={testId ? `${testId}-toolbar` : undefined}>
          {(
            [
              [Bold, t("fmt.bold"), "bold"],
              [Italic, t("fmt.italic"), "italic"],
              [List, t("fmt.list"), "list"],
              [Code, t("fmt.code"), "code"],
              [Link2, t("fmt.link"), "link"],
            ] as const
          ).map(([Icon, label, kind]) => (
            <button key={kind} type="button" onClick={() => format(kind)} className="rounded p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={label} aria-label={label}>
              <Icon size={13} />
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (query !== null && matches.length) {
            if (e.key === "ArrowDown") return (e.preventDefault(), setActive((a) => (a + 1) % matches.length));
            if (e.key === "ArrowUp") return (e.preventDefault(), setActive((a) => (a - 1 + matches.length) % matches.length));
            if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), pick(matches[active]));
            if (e.key === "Escape") return setQuery(null);
          }
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") onSubmit?.();
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        className="w-full resize-none rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1.5 pr-8 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-950"
        aria-label={placeholder}
        data-testid={testId}
      />
      <button type="button" onClick={openPicker} className="absolute right-1.5 top-1.5 rounded p-1 text-neutral-400 hover:text-indigo-600 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("comment.mention")} data-testid={testId ? `${testId}-mention` : undefined}>
        <AtSign size={14} />
      </button>
      {query !== null && matches.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-64 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg p-1" data-testid="mention-list">
          {matches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={cn("w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", i === active ? "bg-indigo-50 dark:bg-indigo-950/60" : "hover:bg-neutral-100 dark:hover:bg-neutral-800")}
            >
              <span className="relative overflow-hidden h-6 w-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: p.avatarColor }}>
                {initials(p.name)}
                <AvatarImg id={p.id} />
              </span>
              <span className="min-w-0">
                <span className="block truncate">{p.name}</span>
                <span className="block truncate text-[11px] text-neutral-400">{p.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/** Renders a comment body with @mentions as highlighted chips (and sanitized Markdown when `markdown`). */
export function CommentBody({ body, className, markdown }: { body: string; className?: string; markdown?: boolean }) {
  if (markdown) {
    const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    // Mentions become placeholders first so Markdown never sees their brackets, then turn into chips.
    const names: string[] = [];
    const md = body.replace(MENTION_RE, (_m, name: string) => `MENTIONTOKEN${names.push(name) - 1}ENDTOKEN`);
    const html = markdownToHtml(md).replace(/MENTIONTOKEN(\d+)ENDTOKEN/g, (_m, i: string) => `<span class="rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 px-1 font-medium" data-testid="mention-chip">@${esc(names[Number(i)] ?? "")}</span>`);
    return <div className={cn("ai-md comment-md break-words", className)} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    if (m.index! > last) parts.push(body.slice(last, m.index));
    parts.push(
      <span key={m.index} className="rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 px-1 font-medium" data-testid="mention-chip">
        @{m[1]}
      </span>
    );
    last = m.index! + m[0].length;
  }
  parts.push(body.slice(last));
  return <p className={cn("whitespace-pre-wrap break-words", className)}>{parts}</p>;
}
