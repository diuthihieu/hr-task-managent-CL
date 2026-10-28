// Shared bits of the browser suite: the signed-in user and the workspace that
// e2e/global.setup.ts creates once, and a `page` that skips the one-off prompts.
import { readFileSync } from "node:fs";
import { test as base, expect, type Page } from "@playwright/test";

export const AUTH_FILE = "e2e/.auth/user.json";
export const SEED_FILE = "e2e/.auth/seed.json";

export type Seed = { email: string; slug: string; wsId: string; projectId: string; taskId: string; dashId: string };

export const test = base.extend<{ seed: Seed; landed: boolean }>({
  // false: behave like a fresh app session (a phone then lands on "All" once).
  landed: [true, { option: true }],
  seed: async ({}, provide) => {
    await provide(JSON.parse(readFileSync(SEED_FILE, "utf8")) as Seed);
  },
  page: async ({ page, landed }, provide) => {
    await page.addInitScript((landed) => {
      try {
        localStorage.setItem("woli.mobileApp.dismissedAt", String(Date.now()));
        if (landed) sessionStorage.setItem("woli.mobileLanded", "1");
      } catch {}
    }, landed);
    await provide(page);
  },
});

export { expect };

/**
 * Layout problems a phone user sees: the page itself scrolling sideways, a panel that scrolls
 * sideways without being meant to, text cut off at a hidden-overflow edge, or a sentence squeezed
 * into a column one or two words wide. Tables, boards and chip rows scroll sideways on purpose.
 */
export async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const bad: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) bad.push(`PAGE scrolls sideways ${document.documentElement.scrollWidth}/${vw}`);
    const label = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}.${String(el.className).slice(0, 80)}`;
    const intended = (el: Element) =>
      /overflow-x-auto|overflow-auto|overflow-x-scroll|no-scrollbar/.test(String(el.className)) || ["grid-view", "kanban", "gantt", "timeline"].some((k) => (el.getAttribute("data-testid") || "").includes(k));
    const all = [...document.querySelectorAll("body *")];
    for (const el of all) {
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowX)) continue;
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && !intended(el)) bad.push(`SIDEWAYS ${label(el)} ${el.scrollWidth}/${el.clientWidth}`);
    }
    // Only what a person reads or taps counts; decorations (blurred circles, SVG paths) may bleed out.
    const hasText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim()) || /^(INPUT|TEXTAREA|SELECT|BUTTON|IMG)$/.test(el.tagName);
    for (const el of all) {
      if (!hasText(el) || el.closest("svg")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.opacity === "0" || /truncate|line-clamp/.test(String(el.className))) continue;
      // Cut = past the edge of the nearest clipping box, or past the screen with nothing above to scroll it into view.
      let clip = Infinity;
      let scrolls = false;
      let ellipsis = false;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (clip === Infinity && (as.textOverflow === "ellipsis" || /line-clamp|truncate/.test(String(a.className)))) {
          ellipsis = true;
          break;
        }
        if (/(auto|scroll)/.test(as.overflowX)) {
          scrolls = true;
          break;
        }
        if (clip === Infinity && /(hidden|clip)/.test(as.overflowX)) clip = a.getBoundingClientRect().right;
      }
      if (ellipsis) continue;
      const limit = Math.min(clip, scrolls ? Infinity : vw);
      if (r.right > limit + 1 && r.left < limit - 4) bad.push(`CUT ${label(el)} right=${Math.round(r.right)}>${Math.round(limit)} "${(el.textContent || "").trim().slice(0, 30)}"`);
    }
    for (const el of document.querySelectorAll("h1,h2,h3,p,span,div,button,a,label")) {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => (n.textContent || "").trim())
        .join(" ")
        .trim();
      if (own.length < 18 || own.split(/\s+/).length < 3) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) continue;
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      if (r.width < 130 && Math.round(r.height / lh) >= 3) bad.push(`SQUEEZED ${label(el)} w=${Math.round(r.width)} "${own.slice(0, 30)}"`);
    }
    return bad.slice(0, 12);
  });
}
