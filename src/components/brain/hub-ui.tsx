"use client";
// Small building blocks shared by the Second Brain hub and its panels (kept out of
// brain-hub.tsx so the panels don't import the hub that imports them).
import Link from "next/link";

/** Small list-card used across the hub. */
export function Card({ title, icon, children, testId, action }: { title: string; icon?: React.ReactNode; children: React.ReactNode; testId?: string; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4" data-testid={testId}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

export function ItemRow({ href, title, sub, extra, testId }: { href?: string; title: string; sub?: string | null; extra?: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 text-sm" data-testid={testId}>
      {href ? (
        <Link href={href} target={href.startsWith("/api/") ? "_blank" : undefined} className="truncate text-neutral-800 dark:text-neutral-100 hover:text-indigo-600">
          {title}
        </Link>
      ) : (
        <span className="truncate">{title}</span>
      )}
      {sub && <span className="text-[11px] text-neutral-400 truncate">{sub}</span>}
      {extra && <span className="ml-auto shrink-0">{extra}</span>}
    </div>
  );
}

export function EmptyNote({ text }: { text: string }) {
  return <p className="px-2 py-2 text-xs text-neutral-500">{text}</p>;
}
