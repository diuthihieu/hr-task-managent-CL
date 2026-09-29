"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Highlight } from "@tiptap/extension-highlight";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Link2,
  ImagePlus,
  Table2,
  Minus,
  Undo2,
  Redo2,
  Highlighter,
  FileSymlink,
} from "lucide-react";
import { BlockId } from "./block-id";
import { LinkPicker, type LinkTarget } from "@/components/brain/link-picker";
import { useT } from "@/components/i18n-provider";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Document-style editor for record pages and wiki pages. Autosaves (debounced)
 * through `onSave`; the server sanitizes the HTML before storing it. Images
 * are uploaded as attachments and referenced through the authorized
 * download route.
 */
export function RichEditor({
  content,
  editable,
  onSave,
  onUploadImage,
  placeholder,
  onSaveStateChange,
  minHeight = 320,
  workspaceId,
  renderBubble,
  onEditor,
}: {
  content: string | null;
  editable: boolean;
  onSave: (html: string) => Promise<void>;
  onUploadImage?: (file: File) => Promise<string>;
  placeholder?: string;
  onSaveStateChange?: (s: SaveState) => void;
  minHeight?: number;
  /** Enables [[ links and "Link to…" (pages, tasks, OKRs, people, decisions…). */
  workspaceId?: string;
  /** Actions shown when text is selected (wiki pages); works in read-only mode too. */
  renderBubble?: (editor: Editor) => React.ReactNode;
  onEditor?: (editor: Editor) => void;
}) {
  const router = useRouter();
  // [[ link picker: where it opens and where the "[[" starts (to replace it).
  const [picker, setPicker] = useState<{ left: number; top: number; from: number | null } | null>(null);
  const wsRef = useRef(workspaceId);
  const { t } = useT();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>(content ?? "");
  const saveRef = useRef(onSave);
  const stateRef = useRef(onSaveStateChange);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    saveRef.current = onSave;
    stateRef.current = onSaveStateChange;
  });

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: !editable, autolink: true, protocols: ["http", "https", "mailto", "tel"] } }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: placeholder ?? t("editor.placeholder") }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      BlockId,
    ],
    content: content ?? "",
    editorProps: {
      attributes: { class: "rich-content focus:outline-none" },
      handleTextInput: (view, from, _to, text) => {
        // Typing "[[" opens the link picker.
        if (text === "[" && wsRef.current && view.state.doc.textBetween(Math.max(0, from - 1), from) === "[") {
          const c = view.coordsAtPos(from);
          setTimeout(() => setPicker({ left: c.left, top: c.bottom + 6, from: from - 1 }), 0);
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(ed), 900);
    },
  });

  function flush(ed: Editor) {
    const html = ed.isEmpty ? "" : ed.getHTML();
    if (html === lastSaved.current) return;
    stateRef.current?.("saving");
    saveRef.current(html)
      .then(() => {
        lastSaved.current = html;
        stateRef.current?.("saved");
      })
      .catch((e) => {
        stateRef.current?.("error");
        toast.error(e instanceof Error ? e.message : t("common.failed"));
      });
  }

  // Save pending edits when leaving the page.
  useEffect(() => {
    return () => {
      if (timer.current && editor) {
        clearTimeout(timer.current);
        flush(editor);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    wsRef.current = workspaceId;
    if (editor) onEditor?.(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report the instance once it exists
  }, [editor, workspaceId]);

  function insertLink(target: LinkTarget) {
    if (!editor) return;
    const at = picker?.from;
    setPicker(null);
    const chain = editor.chain().focus();
    if (at !== null && at !== undefined) {
      // Replace the typed "[[" with the link.
      chain.deleteRange({ from: at, to: at + 2 }).insertContent([{ type: "text", text: target.label, marks: [{ type: "link", attrs: { href: target.href } }] }, { type: "text", text: " " }]).run();
    } else if (!editor.state.selection.empty) {
      chain.extendMarkRange("link").setLink({ href: target.href }).run();
    } else {
      chain.insertContent([{ type: "text", text: target.label, marks: [{ type: "link", attrs: { href: target.href } }] }, { type: "text", text: " " }]).run();
    }
  }

  function openPickerAtSelection() {
    if (!editor) return;
    const c = editor.view.coordsAtPos(editor.state.selection.from);
    setPicker({ left: c.left, top: c.bottom + 6, from: null });
  }

  async function insertImage(file: File) {
    if (!onUploadImage || !editor) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("editor.imagesOnly"));
      return;
    }
    try {
      const src = await onUploadImage(file);
      editor.chain().focus().setImage({ src, alt: file.name }).run();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  function setLink() {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = prompt(t("editor.linkPrompt"), prev ?? "https://");
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  if (!editor) return <div className="text-sm text-neutral-400" style={{ minHeight }}>{t("common.loading")}</div>;

  const btn = (active: boolean) =>
    cn("h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800", active && "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300");

  return (
    <div
      className="rich-editor"
      onDrop={(e) => {
        const file = e.dataTransfer.files?.[0];
        if (file && editable && onUploadImage && file.type.startsWith("image/")) {
          e.preventDefault();
          insertImage(file);
        }
      }}
      onPaste={(e) => {
        const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
        if (file && editable && onUploadImage) {
          e.preventDefault();
          insertImage(file);
        }
      }}
    >
      {editable && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur py-1 mb-3" role="toolbar" aria-label={t("editor.toolbar")}>
          <button className={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} title={t("editor.bold")}><Bold size={14} /></button>
          <button className={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} title={t("editor.italic")}><Italic size={14} /></button>
          <button className={btn(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()} title={t("editor.underline")}><UnderlineIcon size={14} /></button>
          <button className={btn(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()} title={t("editor.strike")}><Strikethrough size={14} /></button>
          <button className={btn(editor.isActive("highlight"))} onClick={() => editor.chain().focus().toggleHighlight().run()} title={t("editor.highlight")}><Highlighter size={14} /></button>
          <span className="w-px h-5 bg-neutral-200 dark:bg-neutral-800 mx-1" />
          <button className={btn(editor.isActive("heading", { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="H1"><Heading1 size={15} /></button>
          <button className={btn(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="H2"><Heading2 size={15} /></button>
          <button className={btn(editor.isActive("heading", { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="H3"><Heading3 size={15} /></button>
          <span className="w-px h-5 bg-neutral-200 dark:bg-neutral-800 mx-1" />
          <button className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t("editor.bullet")}><List size={15} /></button>
          <button className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t("editor.ordered")}><ListOrdered size={15} /></button>
          <button className={btn(editor.isActive("taskList"))} onClick={() => editor.chain().focus().toggleTaskList().run()} title={t("editor.checklist")}><ListChecks size={15} /></button>
          <button className={btn(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={t("editor.quote")}><Quote size={14} /></button>
          <button className={btn(editor.isActive("codeBlock"))} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title={t("editor.code")}><Code2 size={14} /></button>
          <span className="w-px h-5 bg-neutral-200 dark:bg-neutral-800 mx-1" />
          <button className={btn(editor.isActive("link"))} onClick={setLink} title={t("editor.link")}><Link2 size={14} /></button>
          {workspaceId && (
            <button className={btn(false)} onClick={openPickerAtSelection} title={t("brain.link.toolbar")} data-testid="editor-link-to">
              <FileSymlink size={14} />
            </button>
          )}
          {onUploadImage && (
            <>
              <button className={btn(false)} onClick={() => fileRef.current?.click()} title={t("editor.image")}><ImagePlus size={14} /></button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && insertImage(e.target.files[0]).finally(() => (e.target.value = ""))} />
            </>
          )}
          <button className={btn(editor.isActive("table"))} onClick={() => (editor.isActive("table") ? editor.chain().focus().deleteTable().run() : editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())} title={editor.isActive("table") ? t("editor.removeTable") : t("editor.table")}><Table2 size={14} /></button>
          <button className={btn(false)} onClick={() => editor.chain().focus().setHorizontalRule().run()} title={t("editor.divider")}><Minus size={14} /></button>
          <span className="w-px h-5 bg-neutral-200 dark:bg-neutral-800 mx-1" />
          <button className={btn(false)} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title={t("editor.undo")}><Undo2 size={14} /></button>
          <button className={btn(false)} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title={t("editor.redo")}><Redo2 size={14} /></button>
          {editor.isActive("table") && (
            <span className="ml-2 flex items-center gap-1 text-[11px]">
              <button className="px-1.5 py-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => editor.chain().focus().addRowAfter().run()}>+ {t("editor.row")}</button>
              <button className="px-1.5 py-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ {t("editor.column")}</button>
              <button className="px-1.5 py-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => editor.chain().focus().deleteRow().run()}>− {t("editor.row")}</button>
              <button className="px-1.5 py-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => editor.chain().focus().deleteColumn().run()}>− {t("editor.column")}</button>
            </span>
          )}
        </div>
      )}
      <EditorContent
        editor={editor}
        style={{ minHeight }}
        onClickCapture={(e) => {
          // Internal links open inside the app: always when reading, Ctrl/Cmd+click while editing.
          const a = (e.target as HTMLElement).closest("a");
          const href = a?.getAttribute("href");
          if (!href || !/^\/(?!\/)/.test(href) || href.startsWith("/api/")) return;
          if (!editable || e.metaKey || e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            router.push(href);
          }
        }}
      />
      {renderBubble && (
        <BubbleMenu
          editor={editor}
          shouldShow={({ editor: ed, from, to }) => from !== to && !ed.isActive("codeBlock") && !ed.isActive("image")}
          options={{ placement: "top" }}
          // Above the sticky formatting toolbar (z-10).
          className="z-40"
        >
          {renderBubble(editor)}
        </BubbleMenu>
      )}
      {picker && workspaceId && <LinkPicker workspaceId={workspaceId} position={{ left: picker.left, top: picker.top }} onPick={insertLink} onClose={() => setPicker(null)} />}
    </div>
  );
}
