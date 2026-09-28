import { test } from "node:test";
import assert from "node:assert/strict";
import { rankModels } from "../ai/models";

test("rankModels prefers the newest stable Flash text model", () => {
  const list = [
    { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
    { name: "models/gemini-3.8-flash-lite", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.9-flash-preview", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.8-flash-image", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.1-pro", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] },
  ];
  assert.deepEqual(rankModels(list), ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.0-flash", "gemini-3.8-flash-lite", "gemini-3.9-flash-preview"]);
});

test("rankModels ignores models that can't generate text", () => {
  assert.deepEqual(rankModels([{ name: "models/gemini-3.8-flash-tts", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.8-flash" }]), []);
});
