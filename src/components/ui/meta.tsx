// Metadata row: whitespace, chips and small icons instead of "·" / "|" separators.
//   <Meta><MetaChip>C&B</MetaChip><MetaDate value="02 Nov" /><MetaTime actual={2.5} planned={4} /><MetaStatus>In progress</MetaStatus></Meta>
import { CalendarDays, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export function Meta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500 dark:text-neutral-400 min-w-0", className)}>{children}</span>;
}

/** Project, category, wiki, source: a subtle chip. */
export function MetaChip({ children, color, className, title }: { children: React.ReactNode; color?: string | null; className?: string; title?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 max-w-[12rem] rounded-md bg-neutral-100 dark:bg-neutral-800 px-1.5 py-px text-[11px] font-medium text-neutral-600 dark:text-neutral-300", className)} title={title}>
      {color && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Icon + value, e.g. a date, a person, a count. */
export function MetaItem({ icon: Icon, children, className, title }: { icon?: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap tabular-nums", className)} title={title}>
      {Icon && <Icon size={12} strokeWidth={1.75} className="shrink-0 opacity-70" />}
      {children}
    </span>
  );
}

export function MetaDate({ value, className, title }: { value: React.ReactNode; className?: string; title?: string }) {
  return (
    <MetaItem icon={CalendarDays} className={className} title={title}>
      {value}
    </MetaItem>
  );
}

const hours = (n: number) => `${Math.round(n * 10) / 10}h`;
/** "2.5h / 4h" (actual / planned); either side may be missing. */
export function MetaTime({ actual, planned, title }: { actual?: number | null; planned?: number | null; title?: string }) {
  if (!actual && !planned) return null;
  return (
    <MetaItem icon={Clock} title={title}>
      {actual ? hours(actual) : "0h"}
      {planned ? <span className="opacity-60">&nbsp;/ {hours(planned)}</span> : null}
    </MetaItem>
  );
}

/** Lightweight status badge; pass a color for the dot / tint. */
export function MetaStatus({ children, color, className }: { children: React.ReactNode; color?: string | null; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-medium", !color && "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300", className)}
      style={color ? { backgroundColor: `${color}1f`, color } : undefined}
    >
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />}
      {children}
    </span>
  );
}
