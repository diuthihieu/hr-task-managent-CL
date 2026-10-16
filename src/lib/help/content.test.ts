import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { HELP_TABS, searchHelp, type Bi } from "./content";

const allText = (b: Bi) => b.every((s) => typeof s === "string" && s.trim().length > 0);

test("every tab and topic has an id and text in both languages", () => {
  const tabIds = new Set<string>();
  for (const tab of HELP_TABS) {
    assert.ok(!tabIds.has(tab.id), `duplicate tab ${tab.id}`);
    tabIds.add(tab.id);
    assert.ok(allText(tab.title) && allText(tab.intro), tab.id);
    assert.ok(tab.topics.length > 0, `${tab.id} has topics`);
    const topicIds = new Set<string>();
    for (const topic of tab.topics) {
      assert.ok(!topicIds.has(topic.id), `duplicate topic ${tab.id}/${topic.id}`);
      topicIds.add(topic.id);
      for (const b of [topic.title, topic.body, ...(topic.steps ?? []), ...(topic.tips ?? [])]) assert.ok(allText(b), `${tab.id}/${topic.id}`);
    }
  }
});

test("there is a tab for every main menu item", () => {
  for (const id of ["home", "my-work", "inbox", "ai", "agent", "brain", "reports", "okrs", "recognition", "wiki", "projects", "settings"]) assert.ok(HELP_TABS.some((t) => t.id === id), id);
});

test("'open this feature' links point at real pages", () => {
  for (const tab of HELP_TABS) {
    if (tab.path === undefined) continue;
    const dir = `src/app/(app)/w/[workspaceSlug]${tab.path}`;
    assert.ok(existsSync(`${dir}/page.tsx`), `${tab.id} → ${dir}`);
  }
});

test("search matches either language and ignores accents", () => {
  assert.ok(searchHelp("Eisenhower").some((r) => r.topic.id === "eisenhower"));
  assert.ok(searchHelp("phan quyen").some((r) => r.tab.id === "project-settings" && r.topic.id === "permissions"));
  assert.ok(searchHelp("phân quyền").length === searchHelp("phan quyen").length);
  assert.ok(searchHelp("focus 25").some((r) => r.topic.id === "focus"));
  assert.deepEqual(searchHelp("   "), []);
  assert.deepEqual(searchHelp("zzzz-no-such-thing"), []);
});
