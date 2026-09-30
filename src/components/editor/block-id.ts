// Block ids for block-level links (#b-<id>). Stored as data-block-id on
// paragraphs, headings, list items, quotes and code blocks; only assigned
// when someone links to a block, so ordinary pages stay clean.
import { Extension, type Editor } from "@tiptap/core";

const BLOCK_TYPES = ["paragraph", "heading", "listItem", "taskItem", "blockquote", "codeBlock"];

export const BlockId = Extension.create({
  name: "blockId",
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          blockId: {
            default: null,
            // Splitting a block (Enter) must not copy its id to the new block.
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute("data-block-id"),
            renderHTML: (attrs) => (attrs.blockId ? { "data-block-id": attrs.blockId } : {}),
          },
        },
      },
    ];
  },
});

export function newBlockId() {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

/**
 * Id of the innermost block around the selection. When `assign` is set and
 * the block has none yet, one is added (the change autosaves like any edit).
 */
export function blockIdAtSelection(editor: Editor, assign: boolean): string | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (!BLOCK_TYPES.includes(node.type.name)) continue;
    if (node.attrs.blockId) return node.attrs.blockId as string;
    if (!assign || !editor.isEditable) return null;
    const id = newBlockId();
    editor.view.dispatch(editor.state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, blockId: id }));
    return id;
  }
  return null;
}

/**
 * Scrolls to a block (#b-<id>) and flashes it. The flash is an overlay: the
 * editor owns its DOM and would undo classes added to it.
 */
export function revealBlock(root: HTMLElement | Document, blockId: string) {
  const el = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => {
    const r = el.getBoundingClientRect();
    const o = document.createElement("div");
    o.className = "block-flash";
    Object.assign(o.style, { position: "fixed", left: `${r.left - 6}px`, top: `${r.top - 3}px`, width: `${r.width + 12}px`, height: `${r.height + 6}px`, pointerEvents: "none", zIndex: "30" });
    o.dataset.testid = "block-flash";
    document.body.appendChild(o);
    window.setTimeout(() => o.remove(), 2200);
  }, 450);
  return true;
}
