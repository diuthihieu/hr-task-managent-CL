import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function InlineArrow({ className }: { className?: string }) {
  return <ArrowRight size={13} strokeWidth={1.8} aria-hidden className={cn("inline-block shrink-0 text-neutral-400", className)} />;
}
