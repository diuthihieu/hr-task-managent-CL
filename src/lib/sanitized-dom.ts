// Placeholders (mention tokens, [S1] citations) are swapped AFTER sanitizing, so the
// swap must never splice strings into the HTML: a token inside an attribute would
// close it early (BUG-18). Instead the sanitized HTML is parsed into an inert
// <template> and changed through the DOM: tokens in attributes become plain text via
// setAttribute, tokens in text become nodes built with createElement / textContent.
// Self-contained (no imports, no outer references) so tests can run it in a browser.

export type TokenSwap = {
  /** RegExp source, matched globally; groups are passed on as m[1], m[2]... */
  pattern: string;
  /** Replacement text (attributes, and text when `node` returns null). */
  text: (m: string[]) => string;
  /** Replacement node inside text content. */
  node?: (m: string[], doc: Document) => Node | null;
};

export function swapTokens(html: string, swap: TokenSwap, doc?: Document): string {
  const d = doc ?? (typeof document === "undefined" ? null : document);
  if (!d || !html) return html;
  const re = () => new RegExp(swap.pattern, "g");
  const tpl = d.createElement("template");
  tpl.innerHTML = html;
  const walk = (n: Node) => {
    if (n.nodeType === 1) {
      const el = n as Element;
      for (const a of Array.from(el.attributes)) {
        if (re().test(a.value)) el.setAttribute(a.name, a.value.replace(re(), (...args) => swap.text(args.slice(0, -2) as string[])));
      }
    } else if (n.nodeType === 3) {
      const text = n.nodeValue ?? "";
      if (!re().test(text)) return;
      const frag = d.createDocumentFragment();
      let last = 0;
      for (const m of text.matchAll(re())) {
        frag.append(text.slice(last, m.index));
        frag.append(swap.node?.([...m], d) ?? swap.text([...m]));
        last = m.index + m[0].length;
      }
      frag.append(text.slice(last));
      n.parentNode!.replaceChild(frag, n);
      return;
    }
    for (const c of Array.from(n.childNodes)) walk(c);
  };
  walk(tpl.content);
  return tpl.innerHTML;
}
