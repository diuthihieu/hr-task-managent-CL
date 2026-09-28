import Image from "next/image";

/**
 * Soft, slow-moving backdrop for the landing hero: a faint warm gradient, two
 * blurred glows drifting over ~30s and a dotted grid that fades out. Purely
 * decorative (aria-hidden) and frozen when the visitor prefers reduced motion.
 */
export function HeroBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-indigo-50/70 via-white to-white dark:from-indigo-950/30 dark:via-neutral-950 dark:to-neutral-950" />
      <div className="hero-glow hero-glow-a absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full bg-indigo-200/50 blur-3xl dark:bg-indigo-900/30" />
      <div className="hero-glow hero-glow-b absolute top-40 -left-40 h-[420px] w-[420px] rounded-full bg-amber-100/60 blur-3xl dark:bg-amber-900/20" />
      <div className="hero-grid absolute inset-0 opacity-[0.35] dark:opacity-[0.15]" />
    </div>
  );
}

export interface Shot {
  src: string;
  label: string;
}

/**
 * An endless, understated row of real app screenshots. The list is rendered
 * twice and the track slides by half its width, so the loop is seamless.
 * Hover pauses it; reduced-motion visitors get a static, scrollable row.
 */
export function ScreenshotMarquee({ shots, label }: { shots: Shot[]; label: string }) {
  const row = [...shots, ...shots];
  return (
    <div className="marquee relative w-full overflow-hidden py-2" role="region" aria-label={label} data-testid="hero-marquee">
      <div className="marquee-track flex w-max gap-5">
        {row.map((s, i) => (
          <figure key={`${s.src}-${i}`} className="shrink-0 w-[300px] sm:w-[420px] lg:w-[520px]" aria-hidden={i >= shots.length}>
            <div className="rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.18)] overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 h-7 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900">
                <span className="h-2 w-2 rounded-full bg-neutral-300 dark:bg-neutral-700" />
                <span className="h-2 w-2 rounded-full bg-neutral-300 dark:bg-neutral-700" />
                <span className="h-2 w-2 rounded-full bg-neutral-300 dark:bg-neutral-700" />
                <span className="ml-2 text-[10px] text-neutral-400 truncate">woli. · {s.label}</span>
              </div>
              <Image src={s.src} alt={s.label} width={1200} height={750} className="block w-full h-auto" sizes="(min-width: 1024px) 520px, (min-width: 640px) 420px, 300px" priority={i < 2} />
            </div>
            <figcaption className="mt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">{s.label}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
