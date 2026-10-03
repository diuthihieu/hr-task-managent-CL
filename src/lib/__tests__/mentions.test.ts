import assert from "node:assert/strict";
import test from "node:test";
import { RICH_COMMENT_PREFIX, mentionedUserIds, prependMention, richMentionHtml, stripMentions } from "../mentions";

const USER_ID = "123e4567-e89b-12d3-a456-426614174000";

test("rich comments preserve mention ids for permission-filtered notifications", () => {
  const body = `${RICH_COMMENT_PREFIX}<p>Chào ${richMentionHtml("Lan & Minh", USER_ID)}</p>`;
  assert.deepEqual(mentionedUserIds(body), [USER_ID]);
});

test("rich comment excerpts contain readable text without HTML or editor metadata", () => {
  const body = `${RICH_COMMENT_PREFIX}<p><strong>Công việc</strong> cho ${richMentionHtml("Lan & Minh", USER_ID)}</p><ul><li>Kiểm tra</li></ul>`;
  assert.equal(stripMentions(body), "Công việc cho @Lan & Minh\nKiểm tra");
});

test("legacy Markdown mentions remain supported", () => {
  const body = `Chào @[Lan](${USER_ID})`;
  assert.deepEqual(mentionedUserIds(body), [USER_ID]);
  assert.equal(stripMentions(body), "Chào @Lan");
});

test("reply mentions do not flatten an in-progress rich-text draft", () => {
  const draft = `${RICH_COMMENT_PREFIX}<p><strong>Nội dung đang soạn</strong></p>`;
  const next = prependMention(draft, "Lan", USER_ID);
  assert.match(next, /<strong>Nội dung đang soạn<\/strong>/);
  assert.deepEqual(mentionedUserIds(next), [USER_ID]);
  assert.equal(prependMention(next, "Lan", USER_ID), next);
});
