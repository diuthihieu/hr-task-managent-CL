const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** Chart labels and tooltips show at most 2 decimals: a sum of hours such as 92.8999999999999 reads 92.9. */
export function fmtChartNumber(v: unknown): string {
  if (typeof v === "number") return Number.isFinite(v) ? numberFormat.format(v) : "";
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return numberFormat.format(Number(v));
  return v == null ? "" : String(v);
}
