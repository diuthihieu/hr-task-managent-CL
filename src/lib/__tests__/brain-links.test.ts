import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContentLinks, linkedTargets, blockTextAround, normalizeTag, parseHref, entityHref } from "../brain/links-core";

const W = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const T = "33333333-3333-4333-8333-333333333333";
const O = "44444444-4444-4444-8444-444444444444";
const K = "55555555-5555-4555-8555-555555555555";

test("internal links map to entities; external links are ignored", () => {
  const html = `<p>See <a href="/w/hr/wiki/${W}/${P}#b-abc123">guide</a>, <a href="/w/hr/p/${P}/t/${T}">task</a>,
    <a href="/w/hr/okrs/${O}?kr=${K}">KR</a>, <a href="/w/hr/okrs/${O}">OKR</a>, <a href="/w/hr/p/${P}">project</a>,
    <a href="https://example.com/p/${P}">ext</a>, <a href="https://woli.app/w/hr/p/${P}/t/${T}" target="_blank">abs</a></p>`;
  const links = parseContentLinks(html);
  assert.deepEqual(links.map((l) => l.target), [`wiki:${P}`, `task:${T}`, `kr:${K}`, `objective:${O}`, `project:${P}`, `project:${P}`, `task:${T}`]);
  assert.equal(links[0].blockId, "abc123");
  assert.equal(links[0].text, "guide");
  assert.equal(linkedTargets(html).length, 5);
  assert.equal(parseHref("mailto:x@y.z"), null);
});

test("mention context is the surrounding block's text", () => {
  const html = `<h2>Intro</h2><p>First paragraph.</p><p>We decided in <a href="/w/x/wiki/${W}/${P}">the guide</a> to go.</p><p>Last.</p>`;
  const at = html.indexOf("<a ");
  assert.equal(blockTextAround(html, at), "We decided in the guide to go.");
});

test("tags are normalized and hrefs round-trip", () => {
  assert.equal(normalizeTag("  #Onboarding Process "), "onboarding-process");
  assert.equal(normalizeTag("Chính sách"), "chính-sách");
  for (const e of [{ type: "wiki" as const, id: P, wikiId: W, blockId: "abc123" }, { type: "kr" as const, id: K, objectiveId: O }, { type: "person" as const, id: T }]) {
    const hit = parseHref(entityHref("/w/hr", e)!);
    assert.equal(hit?.target, `${e.type}:${e.id}`);
  }
});
