import { test } from "node:test";
import assert from "node:assert/strict";
import { hoursTotalsSection, type HoursTask } from "./hours-totals";

const oct = new Date("2026-10-15T05:00:00Z");
const task = (id: string, names: string[], done = true): HoursTask => ({ id, completedAt: done ? oct : null, dueDate: oct, startDate: null, status: { category: done ? "done" : "todo" }, assignees: names.map((name) => ({ user: { name } })) });
const rowOf = (text: string, prefix: string) => (text.split("\n").find((l) => l.startsWith(prefix)) ?? "").split(" | ");

test("totals on both bases: team counts a shared task once, people count it for each assignee", () => {
  const tasks = [task("a", ["Hieu", "Tam"]), task("b", ["Hieu"]), task("c", ["Tam"], false)];
  const own = new Map([
    ["a", { est: 120, act: 180 }], // 3 h shared
    ["b", { est: 60, act: 30 }],
    ["c", { est: 90, act: 60 }],
  ]);
  const text = hoursTotalsSection(tasks, own);
  // month | tasks | done tasks | estimate h | actual h | actual h of done tasks
  assert.deepEqual(rowOf(text, "2026-10 | 3 |"), ["2026-10", "3", "2", "4.5", "4.5", "3.5"]);
  // person | month | tasks | done | est | act | act done | act/est | share of person-hours | share of person-tasks
  assert.deepEqual(rowOf(text, "Hieu | 2026-10"), ["Hieu", "2026-10", "2", "2", "3", "3.5", "3.5", "116.67%", "46.67%", "50%"]);
  assert.deepEqual(rowOf(text, "Tam | 2026-10"), ["Tam", "2026-10", "2", "1", "3.5", "4", "3", "114.29%", "53.33%", "50%"]);
  // person-tasks 4 vs tasks 3; person-hours 7.5 vs team 4.5; one shared task worth 3 extra hours
  assert.deepEqual(rowOf(text, "2026-10 | 4 |"), ["2026-10", "4", "3", "7.5", "4.5", "1", "3"]);
});

test("no tasks gives no section; unassigned tasks count under (unassigned)", () => {
  assert.equal(hoursTotalsSection([], new Map()), "");
  const text = hoursTotalsSection([task("x", [])], new Map([["x", { est: 0, act: 6 }]]));
  assert.deepEqual(rowOf(text, "(unassigned) | 2026-10").slice(0, 8), ["(unassigned)", "2026-10", "1", "1", "0", "0.1", "0.1", "-"]);
});
