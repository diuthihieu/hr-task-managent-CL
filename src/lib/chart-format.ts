const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** Chart labels and tooltips show at most 2 decimals: a sum of hours such as 92.8999999999999 reads 92.9. */
export function fmtChartNumber(v: unknown): string {
  if (typeof v === "number") return Number.isFinite(v) ? numberFormat.format(v) : "";
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return numberFormat.format(Number(v));
  return v == null ? "" : String(v);
}

/** Radar labels wrap onto up to two lines (long category names were cut off at the chart's edge). */
export function wrapLabel(text: string, max = 16): string[] {
  if (text.length <= max) return [text];
  const words = text.split(/\s+/);
  const lines = [""];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur || (cur + " " + w).length <= max) lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
    else lines.push(w);
  }
  if (lines.length <= 2) return lines;
  const second = lines.slice(1).join(" ");
  return [lines[0], second.length > max ? `${second.slice(0, max - 1)}…` : second];
}
