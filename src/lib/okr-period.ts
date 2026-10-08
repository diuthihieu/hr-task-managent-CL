// OKR cycles as date ranges: a quarter or a year fills its own start / end
// dates, and the "custom range" filter keeps objectives whose period overlaps
// the chosen dates. Shared by the objective dialog, the OKR lists and the API.

export type CycleType = "quarter" | "year" | "custom";
export interface Period {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  end: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-31). */
export function isDateOnly(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function quarterPeriod(quarter: number, year: number): Period {
  const first = (quarter - 1) * 3 + 1;
  const last = first + 2;
  return { start: `${year}-${pad(first)}-01`, end: `${year}-${pad(last)}-${pad(lastDay(year, last))}` };
}

export function yearPeriod(year: number): Period {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export const quarterLabel = (quarter: number, year: number) => `Q${quarter} ${year}`;

/** "Q3 2026", "q3/2026", "2026 Q3" → { quarter: 3, year: 2026 }. */
export function parseQuarterLabel(label: string | null | undefined): { quarter: number; year: number } | null {
  if (!label) return null;
  const m = /\bQ([1-4])\b\D{0,3}(\d{4})\b/i.exec(label) ?? null;
  if (m) return { quarter: Number(m[1]), year: Number(m[2]) };
  const r = /\b(\d{4})\D{0,3}Q([1-4])\b/i.exec(label);
  return r ? { quarter: Number(r[2]), year: Number(r[1]) } : null;
}

/** "2026" or "FY2026" → 2026. */
export function parseYearLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = /\b(?:FY)?(\d{4})\b/i.exec(label);
  return m ? Number(m[1]) : null;
}

export function quarterOf(date: string): { quarter: number; year: number } {
  return { quarter: Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1, year: Number(date.slice(0, 4)) };
}

/**
 * The dates an objective covers: its own start / end when set, otherwise what
 * its cycle label says (Q3 2026, 2026). Null when nothing tells.
 */
export function objectivePeriod(o: { cycleType: string; cycleLabel: string | null; startDate: string | null; endDate: string | null }): Period | null {
  const start = o.startDate?.slice(0, 10) ?? null;
  const end = o.endDate?.slice(0, 10) ?? null;
  if (start && end) return { start, end };
  let fromLabel: Period | null = null;
  if (o.cycleType === "quarter") {
    const q = parseQuarterLabel(o.cycleLabel);
    if (q) fromLabel = quarterPeriod(q.quarter, q.year);
  } else if (o.cycleType === "year") {
    const y = parseYearLabel(o.cycleLabel);
    if (y) fromLabel = yearPeriod(y);
  }
  if (start || end) return { start: start ?? fromLabel?.start ?? end!, end: end ?? fromLabel?.end ?? start! };
  return fromLabel;
}

/** Inclusive overlap; an open side of the range is unbounded. */
export function overlaps(period: Period | null, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  if (!period) return false;
  return (!to || period.start <= to) && (!from || period.end >= from);
}

/** `from` / `to` query params, ignored unless they are real dates (swapped when reversed). */
export function rangeParams(url: URL): { from: string | null; to: string | null } {
  let from = url.searchParams.get("from");
  let to = url.searchParams.get("to");
  if (!isDateOnly(from)) from = null;
  if (!isDateOnly(to)) to = null;
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}
