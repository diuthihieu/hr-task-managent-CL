"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Search, Sparkles, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Woli mascots on the landing page. The illustrations are static: every
 * motion is on the wrapper (translate / rotate / scale), plus glows and a few
 * decorative dots around it. `data-entered` starts the entrance once;
 * `data-inview` pauses the idle loops while the section is off screen. All
 * of it is disabled for prefers-reduced-motion (see globals.css).
 */
function useInView<T extends HTMLElement>(threshold = 0.25) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
       
      setEntered(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        setInView(e.isIntersecting);
        if (e.isIntersecting) setEntered(true);
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, inView, entered };
}

/** Robot 1: the waving guide next to the hero headline. */
export function HeroMascot({ alt }: { alt: string }) {
  const { ref, inView, entered } = useInView<HTMLDivElement>(0.1);
  return (
    <div ref={ref} className="mascot mascot-hero relative mx-auto w-full max-w-[240px] sm:max-w-[320px] lg:max-w-[480px]" data-inview={inView} data-entered={entered} data-testid="mascot-hero">
      <div aria-hidden className="mascot-glow absolute inset-[12%] rounded-full bg-indigo-400/25 blur-3xl dark:bg-indigo-500/20" />
      <div className="mascot-enter mascot-rise relative">
        <div className="mascot-idle mascot-idle-hero">
          <Image src="/mascot/hero-wave.webp" alt={alt} width={1040} height={1142} priority sizes="(min-width: 1024px) 480px, (min-width: 640px) 320px, 240px" className="h-auto w-full select-none drop-shadow-[0_24px_30px_rgba(15,23,42,0.12)]" draggable={false} />
        </div>
      </div>
    </div>
  );
}

/**
 * Robot 2: checklist + thumbs-up beside the task features. Put it inside an
 * element with the `mascot-host` class: hovering the host lifts the robot.
 */
export function TaskMascot({ alt, className }: { alt: string; className?: string }) {
  const { ref, inView, entered } = useInView<HTMLDivElement>(0.3);
  return (
    <div ref={ref} className={cn("mascot mascot-task pointer-events-none", className)} data-inview={inView} data-entered={entered} data-testid="mascot-task">
      <div className="mascot-hover">
        <div className="mascot-enter mascot-enter-left">
          <div className="mascot-idle mascot-idle-float relative">
            <Image src="/mascot/task-checklist.webp" alt={alt} width={880} height={1060} sizes="(min-width: 1024px) 220px, 160px" className="h-auto w-full select-none drop-shadow-[0_18px_24px_rgba(15,23,42,0.14)]" draggable={false} />
            {/* Soft "task done" pulse over the checklist. */}
            <span aria-hidden className="mascot-check-pulse absolute left-[14%] top-[36%] h-[22%] w-[26%] rounded-2xl bg-indigo-400/40" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Robot 3: reading robot with knowledge panels, beside the wiki / AI section. */
export function KnowledgeMascot({ alt, className }: { alt: string; className?: string }) {
  const { ref, inView, entered } = useInView<HTMLDivElement>(0.3);
  const dots = [
    { l: "6%", t: "18%", s: 6, d: "0s" },
    { l: "92%", t: "8%", s: 5, d: "1.4s" },
    { l: "86%", t: "88%", s: 7, d: "2.2s" },
    { l: "2%", t: "70%", s: 4, d: "3s" },
  ];
  return (
    <div ref={ref} className={cn("mascot mascot-knowledge relative", className)} data-inview={inView} data-entered={entered} data-testid="mascot-knowledge">
      <div className="mascot-hover">
        <div className="mascot-enter mascot-enter-right">
          <div className="mascot-idle mascot-idle-tilt relative">
            <Image src="/mascot/knowledge-reader.webp" alt={alt} width={960} height={884} sizes="(min-width: 1024px) 460px, 80vw" className="h-auto w-full select-none drop-shadow-[0_22px_28px_rgba(15,23,42,0.12)]" draggable={false} />
            {/* Occasional glow over the knowledge panels. */}
            <span aria-hidden className="mascot-panel-glow absolute left-[62%] top-[24%] h-[36%] w-[34%] rounded-3xl bg-indigo-300/40 blur-xl" />
          </div>
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {dots.map((p) => (
          <span key={p.l + p.t} className="mascot-particle absolute rounded-full bg-indigo-400/70" style={{ left: p.l, top: p.t, width: p.s, height: p.s, animationDelay: p.d }} />
        ))}
        <span className="mascot-particle absolute left-[48%] top-[-2%] text-indigo-500/70" style={{ animationDelay: "0.8s" }}>
          <Search size={14} />
        </span>
        <span className="mascot-particle absolute left-[-3%] top-[40%] text-indigo-500/60" style={{ animationDelay: "2.6s" }}>
          <Sparkles size={14} />
        </span>
        <span className="mascot-particle absolute left-[96%] top-[52%] text-indigo-500/60" style={{ animationDelay: "4s" }}>
          <BookOpen size={13} />
        </span>
      </div>
    </div>
  );
}
