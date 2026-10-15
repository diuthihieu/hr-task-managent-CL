"use client";
import { useState } from "react";

/**
 * A native date / datetime-local input that doesn't save half-typed years.
 *
 * While the user types a year digit by digit, browsers already report a
 * "valid" value (2 → 0002-12-09). Saving that on every change and feeding
 * the saved value back made the year jump around (1902, 0020…). This keeps a
 * local draft while focused, never overwrites it from outside, and commits
 * when the year is complete (1900-2100, e.g. a date picked from the
 * calendar) or on blur / Enter.
 */
export function DateInput({
  value,
  onCommit,
  type = "date",
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "defaultValue"> & {
  /** "YYYY-MM-DD" (date) or "YYYY-MM-DDTHH:mm" (datetime-local); "" or null when empty. */
  value: string | null | undefined;
  onCommit: (value: string | null) => void;
  type?: "date" | "datetime-local";
}) {
  const external = value ?? "";
  const [draft, setDraft] = useState(external);
  const [focused, setFocused] = useState(false);
  const [lastExternal, setLastExternal] = useState(external);
  /** The value last handed to onCommit (or received from outside). */
  const [committed, setCommitted] = useState(external);
  if (!focused && external !== lastExternal) {
    setLastExternal(external);
    setDraft(external);
    setCommitted(external);
  }
  const commit = (v: string) => {
    if (v === committed) return;
    setCommitted(v);
    onCommit(v || null);
  };
  const completeYear = (v: string) => {
    const y = Number(v.slice(0, 4));
    return /^\d{4}-\d{2}-\d{2}/.test(v) && y >= 1900 && y <= 2100;
  };
  return (
    <input
      {...rest}
      type={type}
      value={draft}
      onFocus={(e) => {
        setFocused(true);
        rest.onFocus?.(e);
      }}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        // Cleared, or a full plausible date (typed to the end or picked): save now.
        if (v === "" || completeYear(v)) commit(v);
      }}
      onBlur={(e) => {
        setFocused(false);
        // A date outside 1900-2100 is still saved once the user leaves the field.
        if (draft === "" || /^\d{4}-\d{2}-\d{2}/.test(draft)) commit(draft);
        rest.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        rest.onKeyDown?.(e);
      }}
    />
  );
}
