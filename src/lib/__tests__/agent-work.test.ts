import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionAgentRun } from "../agent-work/lifecycle";
import { assertAgentToolsAllowed, requiredApprovalForText, SIMPLE_TASK_TOOLS } from "../agent-work/tools";
import { normalizeOutputDefinitions } from "../agent-work/artifact-contract";
import { canDeleteView } from "../view-permissions";

test("Agent Run lifecycle only allows declared forward transitions", () => {
  assert.equal(canTransitionAgentRun("suggested", "confirming"), true);
  assert.equal(canTransitionAgentRun("planning", "running"), true);
  assert.equal(canTransitionAgentRun("running", "completed"), true);
  assert.equal(canTransitionAgentRun("completed", "running"), false);
  assert.equal(canTransitionAgentRun("suggested", "completed"), false);
});

test("Agent tools must be available and explicitly allowed by the active skill", () => {
  assert.doesNotThrow(() => assertAgentToolsAllowed([...SIMPLE_TASK_TOOLS], [...SIMPLE_TASK_TOOLS]));
  assert.throws(() => assertAgentToolsAllowed(["woli.read_task"], ["artifact.save_text"]), /does not allow/);
  assert.throws(() => assertAgentToolsAllowed(["connector.email_send"], ["connector.email_send"]), /not available/);
});

test("sensitive intent requires a human approval boundary", () => {
  assert.equal(requiredApprovalForText("Prepare the payroll reconciliation"), "payroll");
  assert.equal(requiredApprovalForText("Send email to the candidate"), "external_communication");
  assert.equal(requiredApprovalForText("Summarize this project task"), null);
});

test("Artifact Bundle definitions are allowlisted, deduplicated and bounded", () => {
  const definitions = normalizeOutputDefinitions([
    { format: "docx", name: "Report" },
    { format: "docx", name: "Report" },
    { type: "xlsx", name: "Model" },
    { format: "exe", name: "Unsafe" },
    { format: "pdf", name: "PDF" },
    { format: "pptx", name: "Deck" },
    { format: "markdown", name: "Notes" },
    { format: "json", name: "Ignored after limit" },
  ]);
  assert.deepEqual(definitions.map((item) => item.format), ["docx", "xlsx", "pdf", "pptx", "markdown"]);
});

test("Artifact Bundle falls back to a safe Markdown output", () => {
  assert.deepEqual(normalizeOutputDefinitions([{ format: "html", name: "Active content" }]), [{ format: "markdown", name: "Agent result" }]);
});

test("base view deletion is restricted to workspace owner or project creator", () => {
  const base = { userId: "user", projectCreatedById: "creator", viewCreatedById: "view-creator", isBase: true };
  assert.equal(canDeleteView({ ...base, workspaceRole: "admin" }), false);
  assert.equal(canDeleteView({ ...base, userId: "creator", workspaceRole: "viewer" }), true);
  assert.equal(canDeleteView({ ...base, workspaceRole: "owner" }), true);
});

test("regular view deletion includes admin and view creator", () => {
  const regular = { userId: "user", projectCreatedById: "creator", viewCreatedById: "view-creator", isBase: false };
  assert.equal(canDeleteView({ ...regular, workspaceRole: "editor" }), false);
  assert.equal(canDeleteView({ ...regular, workspaceRole: "admin" }), true);
  assert.equal(canDeleteView({ ...regular, userId: "view-creator", workspaceRole: "viewer" }), true);
});
