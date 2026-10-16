/**
 * Source citations in AI answers. Every task in the AI's DATA carries a short
 * ref like [T-1a2b3c4d] (from its id, so it stays the same across turns). The
 * model cites those refs; the server turns each known ref into a link to the
 * task before the answer reaches the browser or is saved. Unknown refs are
 * dropped, so the model can never point a link anywhere we did not build.
 */

export interface CitationTarget {
  url: string;
  title: string;
}

export function taskRef(taskId: string) {
  return `T-${taskId.replace(/-/g, "").slice(0, 8).toLowerCase()}`;
}

// One ref or several in one bracket: [T-1a2b3c4d] / [T-1a2b3c4d, T-5e6f7a8b].
const REF = "T-[0-9a-fA-F]{8}";
const CITE = new RegExp(`\\[(${REF}(?:\\s*[,;]\\s*${REF})*)\\]`, "g");

const escTitle = (s: string) => s.replace(/["\\\n\r]/g, " ").replace(/[[\]]/g, "").slice(0, 120);

export function linkCitations(text: string, refs: Map<string, CitationTarget>): string {
  return text.replace(CITE, (_all, inner: string) =>
    inner
      .split(/\s*[,;]\s*/)
      .map((r) => refs.get(r.toLowerCase().replace(/^t-/, "T-")))
      .filter((t): t is CitationTarget => Boolean(t))
      .map((t) => `[↗](${t.url} "${escTitle(t.title)}")`)
      .join(" ")
  );
}

/**
 * Streaming version: text arrives in chunks and a ref can be split across two
 * of them, so an unfinished "[T-…" at the end of a chunk is held back until the
 * next one (or the end).
 */
export class CitationLinker {
  private pending = "";
  constructor(private refs: Map<string, CitationTarget>) {}

  push(chunk: string): string {
    const text = this.pending + chunk;
    const open = text.lastIndexOf("[");
    // Hold back a "[" that is not closed yet, while it could still become a ref.
    if (open !== -1 && !text.includes("]", open) && text.length - open <= 64 && /^\[(?:T(?:-[0-9a-fA-F,;\s\-T]*)?)?$/.test(text.slice(open))) {
      this.pending = text.slice(open);
      return linkCitations(text.slice(0, open), this.refs);
    }
    this.pending = "";
    return linkCitations(text, this.refs);
  }

  flush(): string {
    const rest = this.pending;
    this.pending = "";
    return linkCitations(rest, this.refs);
  }
}
