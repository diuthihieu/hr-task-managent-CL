// Pre-computed hours totals for AI reports. The model used to add the per-category rows itself and got
// totals wrong (167.90 h where the rows add up to 168.40 h). It also divided per-person hours, where a
// shared task counts for every assignee, by the team total, where it counts once. These tables give it
// the totals ready-made, on both bases, so the report only has to quote them.

export interface HoursTask {
  id: string;
  completedAt: Date | null;
  dueDate: Date | null;
  startDate: Date | null;
  status: { category: string };
  assignees: { user: { id: string; name: string } }[];
}
/** A task's own estimate / actual minutes (a parent's total minus its sub-tasks', see lib/hours.ts). */
export type OwnShare = { est: number; act: number };

const hours = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 10000) / 100}%` : "-");
const monthOf = (t: HoursTask) => {
  const d = t.completedAt ?? t.dueDate ?? t.startDate;
  return d ? d.toISOString().slice(0, 7) : "no date";
};

interface Sum {
  tasks: number;
  done: number;
  est: number;
  act: number;
  actDone: number;
}
const empty = (): Sum => ({ tasks: 0, done: 0, est: 0, act: 0, actDone: 0 });
function add(s: Sum, t: HoursTask, share: OwnShare) {
  const done = t.status.category === "done";
  s.tasks++;
  s.est += share.est;
  s.act += share.act;
  if (done) {
    s.done++;
    s.actDone += share.act;
  }
}

export function hoursTotalsSection(tasks: HoursTask[], own: Map<string, OwnShare>): string {
  const team = new Map<string, Sum>();
  const people = new Map<string, Sum & { person: string; month: string }>();
  const personMonth = new Map<string, Sum & { shared: number; sharedAct: number }>();
  for (const t of tasks) {
    const share = own.get(t.id) ?? { est: 0, act: 0 };
    const m = monthOf(t);
    add(team.get(m) ?? team.set(m, empty()).get(m)!, t, share);
    // One entry per distinct user (by id: display names are not unique).
    const byId = new Map(t.assignees.map((a) => [a.user.id, a.user.name]));
    const names = byId.size ? [...byId.entries()] : [["", "(unassigned)"]];
    const pm = personMonth.get(m) ?? personMonth.set(m, { ...empty(), shared: 0, sharedAct: 0 }).get(m)!;
    if (names.length > 1) {
      pm.shared++;
      pm.sharedAct += share.act * (names.length - 1);
    }
    for (const [userId, person] of names) {
      const key = `${userId}\u0000${person}\u0000${m}`;
      add(people.get(key) ?? people.set(key, { ...empty(), person, month: m }).get(key)!, t, share);
      add(pm, t, share);
    }
  }
  if (!team.size) return "";
  const months = [...team.keys()].sort().reverse();
  const teamRows = months.map((m) => {
    const s = team.get(m)!;
    return [m, s.tasks, s.done, hours(s.est), hours(s.act), hours(s.actDone)].join(" | ");
  });
  const personRows = [...people.values()]
    .sort((a, b) => b.month.localeCompare(a.month) || b.act - a.act || a.person.localeCompare(b.person))
    .map((r) => {
      const pm = personMonth.get(r.month)!;
      return [r.person, r.month, r.tasks, r.done, hours(r.est), hours(r.act), hours(r.actDone), pct(r.act, r.est), pct(r.act, pm.act), pct(r.tasks, pm.tasks)].join(" | ");
    });
  const bridgeRows = months.map((m) => {
    const pm = personMonth.get(m)!;
    const s = team.get(m)!;
    return [m, pm.tasks, s.tasks, hours(pm.act), hours(s.act), pm.shared, hours(pm.sharedAct)].join(" | ");
  });
  return [
    "## Pre-computed totals (quote these; never add up rows yourself)",
    "### Team totals per month (BASIS A: each task counted once, even when it has several assignees)",
    "month | tasks | done tasks | estimate h | actual h | actual h of done tasks",
    ...teamRows,
    "### Per person per month (BASIS B: person-hours - a task with several assignees counts in full for each)",
    "person | month | tasks | done tasks | estimate h | actual h | actual h of done tasks | actual / estimate | share of the month's person-hours | share of the month's person-tasks",
    ...personRows,
    "### Why the two bases differ (sum of BASIS B over people vs BASIS A)",
    "month | person-tasks (sum B) | tasks (A) | person-hours actual (sum B) | team actual h (A) | tasks with several assignees | extra hours from counting shared tasks for each assignee",
    ...bridgeRows,
  ].join("\n");
}
