import { cn } from "@/lib/utils";

/** The woli logo mark (the orange ribbon "w" with its dot). `size` is the height of the box it sits in. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  const h = Math.round(size * 0.8);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static brand asset, sized explicitly (no layout shift)
    <img src="/brand/woli-mark.webp" alt="" aria-hidden="true" width={Math.round(h * 1.86)} height={h} className={cn("shrink-0 select-none", className)} draggable={false} />
  );
}

/** The "woli" wordmark. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("font-bold tracking-tight", className)}>woli</span>;
}

export function Brand({ size = 30, className, textClassName }: { size?: number; className?: string; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark size={size} />
      <Wordmark className={cn("text-lg text-neutral-900 dark:text-neutral-50", textClassName)} />
    </span>
  );
}
