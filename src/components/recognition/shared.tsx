"use client";
import { cn, initials } from "@/lib/utils";

export interface PersonLite {
  id: string;
  name: string;
  avatarColor: string | null;
  hasAvatar?: boolean;
}

export function Avatar({ p, size = 32, className }: { p: PersonLite; size?: number; className?: string }) {
  return p.hasAvatar ? (
    // eslint-disable-next-line @next/next/no-img-element -- authorized avatar route
    <img src={`/api/users/${p.id}/avatar`} alt={p.name} width={size} height={size} className={cn("rounded-full object-cover shrink-0", className)} style={{ width: size, height: size }} />
  ) : (
    <span className={cn("rounded-full flex items-center justify-center text-white font-semibold shrink-0", className)} style={{ width: size, height: size, backgroundColor: p.avatarColor ?? "#6366f1", fontSize: Math.max(10, size * 0.36) }}>
      {initials(p.name)}
    </span>
  );
}

export const STYLE_META: Record<string, { emoji: string; tone: string; ring: string }> = {
  gratitude: { emoji: "🙏", tone: "from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30", ring: "border-amber-200 dark:border-amber-900" },
  appreciation: { emoji: "🌟", tone: "from-yellow-50 to-amber-50 dark:from-yellow-950/40 dark:to-amber-950/30", ring: "border-yellow-200 dark:border-yellow-900" },
  teamwork: { emoji: "🤝", tone: "from-sky-50 to-indigo-50 dark:from-sky-950/40 dark:to-indigo-950/30", ring: "border-sky-200 dark:border-sky-900" },
  above_beyond: { emoji: "🚀", tone: "from-fuchsia-50 to-rose-50 dark:from-fuchsia-950/40 dark:to-rose-950/30", ring: "border-fuchsia-200 dark:border-fuchsia-900" },
  mentor: { emoji: "🌱", tone: "from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/30", ring: "border-emerald-200 dark:border-emerald-900" },
};

/** Thousands separated with "," everywhere (6000 -> 6,000). */
export const fmtNumber = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
