import { cn } from "@/lib/utils";

/** The woli. mark: an orange tile with a white "w" and the brand dot. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={cn("shrink-0", className)} aria-hidden="true">
      <defs>
        <linearGradient id="woli-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb923c" />
          <stop offset="1" stopColor="#ea580c" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#woli-g)" />
      <path d="M14 22 L22.5 44 L31 27 L39.5 44 L48 22" fill="none" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="52" cy="44" r="4" fill="white" />
    </svg>
  );
}

/** "woli." wordmark; the dot takes the accent colour. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-bold tracking-tight", className)}>
      woli<span className="text-indigo-600">.</span>
    </span>
  );
}

export function Brand({ size = 30, className, textClassName }: { size?: number; className?: string; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark size={size} />
      <Wordmark className={cn("text-lg text-neutral-900 dark:text-neutral-50", textClassName)} />
    </span>
  );
}
