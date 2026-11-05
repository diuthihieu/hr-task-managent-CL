// Client-safe helpers for <input type="datetime-local">.
// The server stores date-times as UTC ISO strings ("2026-10-24T02:30:00.000Z"), but the input shows
// and returns wall-clock time with no zone ("2026-10-24T09:30"). Slicing the ISO string showed UTC
// as if it were local time, so a Vietnamese user saw every completed time 7 hours early (and the day
// before for times entered before 07:00).

const pad = (n: number) => String(n).padStart(2, "0");

/** A stored date-time -> "YYYY-MM-DDTHH:mm" in the viewer's local time ("" when empty / invalid). */
export function isoToLocalInput(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const s = String(value);
  // No zone: already wall-clock time.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) : "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** What the user typed (local wall-clock time) -> UTC ISO string for the server (null when empty / invalid). */
export function localInputToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A stored date-time -> its "YYYY-MM-DD" day in the viewer's local time ("" when empty / invalid). */
export function isoToLocalDate(value: unknown): string {
  return isoToLocalInput(value).slice(0, 10);
}

/**
 * A picked day -> UTC ISO string, for date-time fields shown as a date only (e.g. the completed time in
 * the sub-task list). The time of day already stored is kept; with none, local noon is used so the day
 * stays the same however a report buckets it (server UTC, or any viewer's time zone).
 */
export function localDateToIso(day: string | null | undefined, previous?: unknown): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = isoToLocalInput(previous).slice(11, 16) || "12:00";
  return localInputToIso(`${day}T${time}`);
}
