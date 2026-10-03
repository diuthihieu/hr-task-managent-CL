"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { AtSign, Bold, Code, Italic, Link2, List, ListOrdered, Redo2, Strikethrough, Underline, Undo2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { AvatarImg } from "@/components/ui/avatar-img";
import { api } from "@/lib/api-client";
import { MENTION_RE, RICH_COMMENT_PREFIX, isRichComment, richCommentHtml, richMentionHtml } from "@/lib/mentions";
import { cn, initials } from "@/lib/utils";

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

const CommentMention = Node.create({
  name: "commentMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { id: { default: "" }, label: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-woli-mention]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return { id: element.dataset.woliMention ?? "", label: (element.textContent ?? "").replace(/^@/, "") };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-woli-mention": node.attrs.id }), `@${node.attrs.label}`];
  },
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Convert reply-prefill/legacy plain text to editor HTML without interpreting Markdown markers. */
function editorHtmlFromBody(body: string) {
  if (!body) return "";
  if (isRichComment(body)) return richCommentHtml(body);
  let html = "";
  let last = 0;
  for (const match of body.matchAll(MENTION_RE)) {
    html += escapeHtml(body.slice(last, match.index)).replace(/\r?\n/g, "<br>");
    html += richMentionHtml(match[1], match[2]);
    last = match.index! + match[0].length;
  }
  html += escapeHtml(body.slice(last)).replace(/\r?\n/g, "<br>");
  return `<p>${html}</p>`;
}

function bodyFromEditor(editor: Editor) {
  return editor.isEmpty ? "" : `${RICH_COMMENT_PREFIX}${editor.getHTML()}`;
}

type MentionRange = { from: number; to: number; query: string };

export interface RichCommentInputHandle {
  focus: () => void;
}

/** Teams-style WYSIWYG comment editor: selection is formatted in place, never as visible Markdown syntax. */
export const RichCommentInput = forwardRef<RichCommentInputHandle, {
  peopleUrl: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}>(function RichCommentInput({ peopleUrl, value, onChange, onSubmit, placeholder, className, testId }, ref) {
  const { t } = useT();
  const [people, setPeople] = useState<Person[]>([]);
  const [mentionRange, setMentionRange] = useState<MentionRange | null>(null);
  const [active, setActiveState] = useState(0);
  const emittedValue = useRef(value);
  const submitRef = useRef(onSubmit);
  const rangeRef = useRef<MentionRange | null>(null);
  const matchesRef = useRef<Person[]>([]);
  const activeRef = useRef(0);
  const pickRef = useRef<(person: Person) => void>(() => {});

  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    let alive = true;
    if (peopleUrl) loadPeople(peopleUrl).then((result) => alive && setPeople(result));
    return () => {
      alive = false;
    };
  }, [peopleUrl]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false, link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto", "tel"] } }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      CommentMention,
    ],
    content: editorHtmlFromBody(value),
    editorProps: {
      attributes: {
        class: "comment-editor-content focus:outline-none",
        ...(testId ? { "data-testid": testId } : {}),
      },
      handleKeyDown: (_view, event) => {
        const matches = matchesRef.current;
        if (rangeRef.current && matches.length) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((activeRef.current + 1) % matches.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((activeRef.current - 1 + matches.length) % matches.length);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            pickRef.current(matches[activeRef.current]);
            return true;
          }
          if (event.key === "Escape") {
            closeMentions();
            return true;
          }
        }
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          submitRef.current?.();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = bodyFromEditor(current);
      emittedValue.current = next;
      onChange(next);
      detectMention(current);
    },
    onSelectionUpdate: ({ editor: current }) => detectMention(current),
  });

  useImperativeHandle(ref, () => ({ focus: () => editor?.commands.focus() }), [editor]);

  useEffect(() => {
    if (!editor || value === emittedValue.current) return;
    emittedValue.current = value;
    editor.commands.setContent(editorHtmlFromBody(value), { emitUpdate: false });
    closeMentions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- synchronize externally-cleared drafts only
  }, [editor, value]);

  const matches = useMemo(() => {
    if (!mentionRange) return [];
    const query = mentionRange.query.toLocaleLowerCase();
    return people.filter((person) => person.name.toLocaleLowerCase().includes(query) || person.email.toLocaleLowerCase().includes(query)).slice(0, 6);
  }, [mentionRange, people]);
  matchesRef.current = matches;

  function setActive(next: number) {
    activeRef.current = next;
    setActiveState(next);
  }

  function setRange(next: MentionRange | null) {
    rangeRef.current = next;
    setMentionRange(next);
  }

  function closeMentions() {
    setRange(null);
    setActive(0);
  }

  function detectMention(current: Editor) {
    const { selection } = current.state;
    const { $from } = selection;
    if (!selection.empty || !$from.parent.isTextblock) return closeMentions();
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
    const match = before.match(/(^|\s)@([^\s@]{0,30})$/u);
    if (!match) return closeMentions();
    const query = match[2];
    setRange({ from: selection.from - query.length - 1, to: selection.from, query });
    setActive(0);
  }

  function pick(person: Person) {
    if (!editor || !rangeRef.current) return;
    const range = rangeRef.current;
    editor
      .chain()
      .focus()
      .deleteRange({ from: range.from, to: range.to })
      .insertContent([{ type: "commentMention", attrs: { id: person.id, label: person.name } }, { type: "text", text: " " }])
      .run();
    closeMentions();
  }
  pickRef.current = pick;

  function openMentionPicker() {
    if (!editor) return;
    const { from } = editor.state.selection;
    const previous = from > 1 ? editor.state.doc.textBetween(from - 1, from) : "";
    editor.chain().focus().insertContent(previous && !/\s/.test(previous) ? " @" : "@").run();
  }

  function setLink() {
    if (!editor) return;
    const current = editor.getAttributes("link").href as string | undefined;
    const url = prompt(t("editor.linkPrompt"), current ?? "https://");
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  if (!editor) return <div className={cn("min-h-20 flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700", className)} />;

  const buttonClass = (active: boolean) =>
    cn(
      "inline-flex h-7 w-7 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100",
      active && "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
    );
  const toolbarButton = (label: string, activeState: boolean, action: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      className={buttonClass(activeState)}
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {icon}
    </button>
  );

  return (
    <div className={cn("relative min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-within:ring-indigo-950", className)}>
      <EditorContent editor={editor} />
      <div className="flex flex-wrap items-center gap-0.5 border-t border-neutral-200 px-1.5 py-1 dark:border-neutral-800" role="toolbar" aria-label={t("editor.toolbar")} data-testid={testId ? `${testId}-toolbar` : undefined}>
        {toolbarButton(t("fmt.bold"), editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <Bold size={15} />)}
        {toolbarButton(t("fmt.italic"), editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <Italic size={15} />)}
        {toolbarButton(t("editor.underline"), editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), <Underline size={15} />)}
        {toolbarButton(t("editor.strike"), editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), <Strikethrough size={15} />)}
        <span className="mx-0.5 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
        {toolbarButton(t("fmt.list"), editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <List size={15} />)}
        {toolbarButton(t("editor.ordered"), editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={15} />)}
        {toolbarButton(t("fmt.code"), editor.isActive("code"), () => editor.chain().focus().toggleCode().run(), <Code size={15} />)}
        {toolbarButton(t("fmt.link"), editor.isActive("link"), setLink, <Link2 size={15} />)}
        <span className="mx-0.5 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
        {toolbarButton(t("comment.mention"), false, openMentionPicker, <AtSign size={15} />)}
        <span className="flex-1" />
        {toolbarButton(t("editor.undo"), false, () => editor.chain().focus().undo().run(), <Undo2 size={15} />)}
        {toolbarButton(t("editor.redo"), false, () => editor.chain().focus().redo().run(), <Redo2 size={15} />)}
      </div>
      {mentionRange && matches.length > 0 && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900" data-testid="mention-list">
          {matches.map((person, index) => (
            <button
              key={person.id}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                pick(person);
              }}
              className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", index === active ? "bg-indigo-50 dark:bg-indigo-950/60" : "hover:bg-neutral-100 dark:hover:bg-neutral-800")}
            >
              <span className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: person.avatarColor }}>
                {initials(person.name)}
                <AvatarImg id={person.id} />
              </span>
              <span className="min-w-0">
                <span className="block truncate">{person.name}</span>
                <span className="block truncate text-[11px] text-neutral-400">{person.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
