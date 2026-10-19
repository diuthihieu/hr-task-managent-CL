import type { GridClipboardPayload } from "./grid-clipboard";

/**
 * The last typed copy from any task grid in this tab. It lives in module memory (not in browser
 * storage) so it survives moving to another project's grid, and is dropped on reload.
 * The system clipboard still carries the plain text for other apps; the typed copy is only used
 * when that text is unchanged, i.e. nothing else was copied since.
 */
let current: GridClipboardPayload | null = null;

export const setGridClipboard = (payload: GridClipboardPayload | null) => {
  current = payload;
};

export const getGridClipboard = () => current;
