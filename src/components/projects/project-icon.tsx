"use client";
import {
  Folder, Briefcase, Users, UserPlus, GraduationCap, BookOpen, Wallet, Banknote, Receipt, Calculator, BarChart3, PieChart, Target, Flag, Rocket, Lightbulb,
  Calendar, Clock, ClipboardList, ListChecks, FileText, ShieldCheck, HeartHandshake, Award, Building2, Globe, Megaphone, MessageSquare, Laptop, Wrench, Package, Truck,
  ShoppingCart, Star, Heart, Leaf, Coffee, Sparkles, Trophy, Puzzle, Ban, Check,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useT } from "@/components/i18n-provider";
import { PROJECT_ICON_KEYS, type ProjectIconKey } from "@/lib/project-icons";
import { cn } from "@/lib/utils";

type Icon = React.ComponentType<{ size?: number; className?: string }>;
const ICONS: Record<ProjectIconKey, Icon> = {
  folder: Folder, briefcase: Briefcase, users: Users, "user-plus": UserPlus, "graduation-cap": GraduationCap, "book-open": BookOpen, wallet: Wallet, banknote: Banknote,
  receipt: Receipt, calculator: Calculator, "chart-bar": BarChart3, "chart-pie": PieChart, target: Target, flag: Flag, rocket: Rocket, lightbulb: Lightbulb,
  calendar: Calendar, clock: Clock, "clipboard-list": ClipboardList, "list-checks": ListChecks, "file-text": FileText, "shield-check": ShieldCheck, "heart-handshake": HeartHandshake, award: Award,
  building: Building2, globe: Globe, megaphone: Megaphone, "message-square": MessageSquare, laptop: Laptop, wrench: Wrench, package: Package, truck: Truck,
  "shopping-cart": ShoppingCart, star: Star, heart: Heart, leaf: Leaf, coffee: Coffee, sparkles: Sparkles, trophy: Trophy, puzzle: Puzzle,
};

/** A project's icon in the accent colour, or nothing when the project has none. */
export function ProjectIcon({ icon, size = 14, className }: { icon: string | null | undefined; size?: number; className?: string }) {
  const C = icon ? ICONS[icon as ProjectIconKey] : undefined;
  if (!C) return null;
  return <C size={size} className={cn("shrink-0 text-indigo-600 dark:text-indigo-400", className)} />;
}

/** Icon picker: "No icon" plus the basic set, all shown in the accent colour. */
export function ProjectIconPicker({ value, onChange, disabled }: { value: string | null; onChange: (icon: string | null) => void; disabled?: boolean }) {
  const { t } = useT();
  const Current = value ? ICONS[value as ProjectIconKey] : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className="inline-flex items-center gap-2 h-9 rounded-md border border-neutral-200 dark:border-neutral-700 px-3 text-sm hover:border-indigo-300 disabled:opacity-60" data-testid="project-icon-picker">
          {Current ? <Current size={16} className="text-indigo-600 dark:text-indigo-400" /> : <Ban size={14} className="text-neutral-400" />}
          <span className="text-neutral-700 dark:text-neutral-200">{Current ? t("pi.change") : t("pi.none")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <button type="button" onClick={() => onChange(null)} className={cn("w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800", !value && "bg-indigo-50 dark:bg-indigo-950/60")} data-testid="project-icon-none">
          <Ban size={14} className="text-neutral-400" /> {t("pi.none")}
          {!value && <Check size={13} className="ml-auto text-indigo-600" />}
        </button>
        <div className="grid grid-cols-8 gap-1 mt-2">
          {PROJECT_ICON_KEYS.map((k) => {
            const C = ICONS[k];
            return (
              <button key={k} type="button" onClick={() => onChange(k)} title={k} aria-label={k} className={cn("h-8 w-8 rounded-md flex items-center justify-center hover:bg-indigo-50 dark:hover:bg-indigo-950/60", value === k && "bg-indigo-100 dark:bg-indigo-900/60 ring-1 ring-indigo-400")} data-testid={`project-icon-${k}`}>
                <C size={16} className="text-indigo-600 dark:text-indigo-400" />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
