import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCommentReactions } from "../comment-reactions";

test("comment reactions group by emoji and mark the current user's reaction", () => {
  const rows = [
    { emoji: "👍", userId: "u2", user: { name: "Bình" } },
    { emoji: "❤️", userId: "u1", user: { name: "An" } },
    { emoji: "👍", userId: "u1", user: { name: "An" } },
  ];
  assert.deepEqual(summarizeCommentReactions(rows, "u1"), [
    { emoji: "👍", count: 2, mine: true, names: ["An", "Bình"] },
    { emoji: "❤️", count: 1, mine: true, names: ["An"] },
  ]);
});

test("comment reactions discard unsupported values from legacy or crafted rows", () => {
  assert.deepEqual(summarizeCommentReactions([{ emoji: "<script>", userId: "u1", user: { name: "An" } }], "u1"), []);
});
