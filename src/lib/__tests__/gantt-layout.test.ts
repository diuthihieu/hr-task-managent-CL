import assert from "node:assert/strict";
import test from "node:test";
import {
  fitGanttTaskColumnWidth,
  GANTT_TASK_COLUMN_MAX_WIDTH,
  GANTT_TASK_COLUMN_MIN_WIDTH,
} from "../gantt-layout";

test("Gantt task column fits content within readable limits", () => {
  assert.equal(fitGanttTaskColumnWidth([]), GANTT_TASK_COLUMN_MIN_WIDTH);
  assert.ok(fitGanttTaskColumnWidth(["A substantially longer task title"]) > GANTT_TASK_COLUMN_MIN_WIDTH);
  assert.equal(fitGanttTaskColumnWidth(["Task ".repeat(200)]), GANTT_TASK_COLUMN_MAX_WIDTH);
});
