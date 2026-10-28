import { test, expect } from "@playwright/test";
import path from "node:path";
import { build } from "esbuild";
import { swapTokens } from "../src/lib/sanitized-dom";

// Runs the real token swap in a browser on the same marked + DOMPurify output the app
// renders (no server or sign-in needed). BUG-18: nothing may be spliced into sanitized HTML.
const lib = (p: string) => path.join(process.cwd(), "node_modules", p);
const PAYLOAD = '<img src="/favicon.ico" alt="@[x](00000000-0000-0000-0000-000000000000)<img src=x onerror=alert(document.domain)>"> hi @[Mai](11111111-1111-4111-8111-111111111111) [l](https://e.com "@[t](22222222-2222-4222-8222-222222222222)")';

test.beforeEach(async ({ page }) => {
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ path: lib("dompurify/dist/purify.min.js") });
  await page.addScriptTag({ path: lib("marked/lib/marked.umd.js") });
});

test("mention chips are built in the DOM: attributes stay intact, every chip is a span", async ({ page }) => {
  const out = await page.evaluate(
    ([src, body]) => {
      const swap = new Function(`return (${src})`)() as (html: string, s: unknown) => string;
      const w = window as unknown as { marked: { parse: (s: string) => string }; DOMPurify: { sanitize: (s: string, o: unknown) => string; addHook: (h: string, f: (n: Element) => void) => void } };
      w.DOMPurify.addHook("afterSanitizeAttributes", (n) => {
        if (n.tagName === "A" && n.getAttribute("href")) {
          n.setAttribute("target", "_blank");
          n.setAttribute("rel", "noopener noreferrer");
        }
      });
      const names: string[] = [];
      const md = body.replace(/@\[([^\]]+)\]\(([0-9a-f-]{36})\)/g, (_m: string, name: string) => `MENTIONTOKEN${names.push(name) - 1}ENDTOKEN`);
      const clean = w.DOMPurify.sanitize(w.marked.parse(md), { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button", "iframe"], FORBID_ATTR: ["style"] });
      const html = swap(clean, {
        pattern: "MENTIONTOKEN(\\d+)ENDTOKEN",
        text: (m: string[]) => `@${names[Number(m[1])] ?? ""}`,
        node: (m: string[], doc: Document) => {
          const chip = doc.createElement("span");
          chip.className = "chip";
          chip.setAttribute("data-testid", "mention-chip");
          chip.textContent = `@${names[Number(m[1])] ?? ""}`;
          return chip;
        },
      });
      document.body.innerHTML = html;
      const img = document.querySelector("img")!;
      const a = document.querySelector("a")!;
      return {
        alt: img.getAttribute("alt"),
        onerror: document.querySelectorAll("img[onerror]").length,
        chips: Array.from(document.querySelectorAll('[data-testid="mention-chip"]')).map((e) => `${e.tagName}:${e.textContent}`),
        link: [a.getAttribute("title"), a.getAttribute("target"), a.getAttribute("rel")],
      };
    },
    [swapTokens.toString(), PAYLOAD] as const
  );
  expect(out.alt).toContain("@x");
  expect(out.alt).not.toContain("MENTIONTOKEN");
  expect(out.onerror).toBe(0);
  expect(out.chips).toEqual(["SPAN:@Mai"]);
  expect(out.link).toEqual(["@t", "_blank", "noopener noreferrer"]);
});

test("citation links are built in the DOM: a source title can't break out of its attribute", async ({ page }) => {
  const out = await page.evaluate(
    ([src]) => {
      const swap = new Function(`return (${src})`)() as (html: string, s: unknown) => string;
      const title = '"><img src=x onerror=alert(1)>';
      const html = swap('<p>See [S1] and [S9], <img alt="[S1]" src="/a.png"></p>', {
        pattern: "\\[S(\\d{1,3})\\]",
        text: (m: string[]) => m[0],
        node: (m: string[], doc: Document) => {
          if (m[1] !== "1") return null;
          const a = doc.createElement("a");
          a.className = "brain-cite";
          a.setAttribute("href", `#src-${m[1]}`);
          a.setAttribute("title", title);
          a.textContent = m[0];
          return a;
        },
      });
      document.body.innerHTML = html;
      return {
        cites: Array.from(document.querySelectorAll("a.brain-cite")).map((a) => [a.getAttribute("title"), a.textContent]),
        alt: document.querySelector("img")!.getAttribute("alt"),
        imgs: document.querySelectorAll("img").length,
        text: document.body.textContent,
      };
    },
    [swapTokens.toString()] as const
  );
  expect(out.cites).toEqual([['"><img src=x onerror=alert(1)>', "[S1]"]]);
  expect(out.imgs).toBe(1);
  expect(out.alt).toBe("[S1]");
  expect(out.text).toContain("[S9]");
});

test("report charts become figures built in the DOM; titles and markdown stay text", async ({ page }) => {
  // The real buildReportHtml (with its own marked + DOMPurify), bundled for the browser.
  const bundle = await build({ entryPoints: ["src/components/ai/print-report.ts"], bundle: true, write: false, format: "iife", globalName: "report", platform: "browser", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const out = await page.evaluate(() => {
    const { buildReportHtml } = (window as unknown as { report: { buildReportHtml: (o: unknown) => string } }).report;
    const html = buildReportHtml({
      title: "Q3",
      workspace: "HR",
      author: "Mai",
      locale: "en",
      markdown: 'Intro <img alt="WOLICHART0WOLICHART<img src=x onerror=alert(1)>" src="/a.png">\n\n[[chart:c1]]\n\n[[chart:missing]]\n\nEnd',
      charts: [{ id: "c1", title: '</figcaption><img src=x onerror=alert(2)>', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/><script>alert(3)</script></svg>' }],
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    return {
      figures: Array.from(doc.querySelectorAll("figure.chart")).map((f) => [f.querySelector("figcaption")?.textContent, !!f.querySelector("svg rect"), !!f.querySelector("script")]),
      onerror: doc.querySelectorAll("[onerror]").length,
      alt: doc.querySelector("main img")?.getAttribute("alt"),
    };
  });
  expect(out.figures).toEqual([["</figcaption><img src=x onerror=alert(2)>", true, false]]);
  expect(out.onerror).toBe(0);
  expect(out.alt).toContain("WOLICHART0WOLICHART");
});
