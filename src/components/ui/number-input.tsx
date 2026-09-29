"use client";
// Number field that shows thousands separators while typing (6000 -> 6,000)
// and hands back a plain number. The caret stays after the same digit.
import { useLayoutEffect, useRef, useState } from "react";
import { Input } from "./input";

const GROUP = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** 6000 -> "6,000", 1234.5 -> "1,234.5" (always "," for thousands). */
export const formatThousands = (n: number | null | undefined, maxFraction = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? "" : new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFraction }).format(n);

function display(raw: string, decimals: boolean) {
  const clean = raw.replace(decimals ? /[^\d.]/g : /\D/g, "");
  if (!clean) return "";
  const [int, ...rest] = clean.split(".");
  const intPart = int.replace(/^0+(?=\d)/, "");
  const grouped = intPart ? GROUP.format(Number(intPart)) : "0";
  return decimals && rest.length ? `${grouped}.${rest.join("").slice(0, 2)}` : grouped;
}

export function NumberInput({
  value,
  onValueChange,
  decimals = false,
  min,
  max,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max"> & {
  value: number | null;
  onValueChange: (v: number | null) => void;
  decimals?: boolean;
  min?: number;
  max?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => formatThousands(value));
  const caret = useRef<number | null>(null);
  const [lastValue, setLastValue] = useState(value);
  // Follow outside changes (e.g. the form was reset).
  if (value !== lastValue) {
    setLastValue(value);
    const parsed = Number(text.replace(/,/g, ""));
    if (value === null ? text !== "" : parsed !== value) setText(formatThousands(value));
  }

  useLayoutEffect(() => {
    // Put the caret back after the same number of digits it had before formatting.
    const el = ref.current;
    if (!el || caret.current === null || document.activeElement !== el) return;
    let digits = caret.current;
    let pos = 0;
    while (pos < text.length && digits > 0) {
      if (/[\d.]/.test(text[pos])) digits--;
      pos++;
    }
    el.setSelectionRange(pos, pos);
    caret.current = null;
  }, [text]);

  return (
    <Input
      ref={ref}
      {...props}
      type="text"
      inputMode={decimals ? "decimal" : "numeric"}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        const before = raw.slice(0, e.target.selectionStart ?? raw.length);
        caret.current = before.replace(/[^\d.]/g, "").length;
        const next = display(raw, decimals);
        setText(next);
        const n = next ? Number(next.replace(/,/g, "")) : null;
        setLastValue(n);
        onValueChange(n);
      }}
      onBlur={(e) => {
        // Clamp to the allowed range when leaving the field.
        const n = text ? Number(text.replace(/,/g, "")) : null;
        if (n !== null && ((min !== undefined && n < min) || (max !== undefined && n > max))) {
          const c = Math.min(max ?? n, Math.max(min ?? n, n));
          setText(formatThousands(c));
          setLastValue(c);
          onValueChange(c);
        }
        props.onBlur?.(e);
      }}
    />
  );
}
