// Home widgets: the catalog (what exists, which sizes and styles each has),
// the five suggested layouts, and validation of saved layouts / templates.
// Shared by the browser (editor) and the API (validation).
import { z } from "zod";

export const WIDGET_SIZES = ["s", "m", "l", "xl"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export const METRICS = ["open", "in_progress", "overdue", "due_today", "done_30d", "completion_rate", "focus_week", "waiting"] as const;
export type MetricKey = (typeof METRICS)[number];

export type WidgetGroup = "metrics" | "tasks" | "tracking" | "goals" | "dashboards" | "other";

interface WidgetDef {
  group: WidgetGroup;
  styles: readonly string[];
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  /** Several copies make sense (metrics, dashboards, notes). */
  multiple?: boolean;
}

export const WIDGETS = {
  kpis: { group: "metrics", styles: ["cards", "compact", "big"], sizes: ["l", "xl"], defaultSize: "xl" },
  metric: { group: "metrics", styles: ["tile", "big", "ring"], sizes: ["s", "m"], defaultSize: "s", multiple: true },
  focus: { group: "tasks", styles: ["banner", "card"], sizes: ["m", "l", "xl"], defaultSize: "xl" },
  my_day: { group: "tasks", styles: ["list", "compact"], sizes: ["s", "m", "l", "xl"], defaultSize: "s" },
  attention: { group: "tasks", styles: ["list", "compact"], sizes: ["s", "m", "l", "xl"], defaultSize: "s" },
  waiting: { group: "tasks", styles: ["list", "compact"], sizes: ["s", "m", "l", "xl"], defaultSize: "s" },
  completed: { group: "tasks", styles: ["list", "compact"], sizes: ["s", "m", "l", "xl"], defaultSize: "s" },
  my_tasks: { group: "tasks", styles: ["table", "list"], sizes: ["m", "l", "xl"], defaultSize: "xl" },
  deadlines: { group: "tracking", styles: ["list", "strip"], sizes: ["m", "l", "xl"], defaultSize: "m" },
  focus_time: { group: "tracking", styles: ["bars", "number"], sizes: ["s", "m", "l"], defaultSize: "m" },
  activity: { group: "tracking", styles: ["timeline", "compact"], sizes: ["s", "m", "l", "xl"], defaultSize: "m" },
  okrs: { group: "goals", styles: ["bars", "rings"], sizes: ["m", "l", "xl"], defaultSize: "m" },
  projects: { group: "goals", styles: ["cards", "list"], sizes: ["m", "l", "xl"], defaultSize: "xl" },
  dashboard: { group: "dashboards", styles: ["grid", "single"], sizes: ["m", "l", "xl"], defaultSize: "xl", multiple: true },
  note: { group: "other", styles: ["sticky", "plain"], sizes: ["s", "m", "l", "xl"], defaultSize: "s", multiple: true },
} satisfies Record<string, WidgetDef>;

export type WidgetType = keyof typeof WIDGETS;
export const WIDGET_TYPES = Object.keys(WIDGETS) as WidgetType[];
export const WIDGET_GROUPS: WidgetGroup[] = ["metrics", "tasks", "tracking", "goals", "dashboards", "other"];

export interface WidgetConfig {
  metric?: MetricKey;
  dashboardId?: string;
  blockId?: string;
  text?: string;
  title?: string;
}
export interface HomeWidget {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  style: string;
  config?: WidgetConfig;
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const widgetSchema = z.object({
  id: z.string().min(1).max(40).regex(/^[\w-]+$/),
  type: z.enum(WIDGET_TYPES as [WidgetType, ...WidgetType[]]),
  size: z.enum(WIDGET_SIZES),
  style: z.string().max(20),
  config: z
    .object({
      metric: z.enum(METRICS).optional(),
      dashboardId: uuid.optional(),
      blockId: uuid.optional(),
      text: z.string().max(2000).optional(),
      title: z.string().max(80).optional(),
    })
    .optional(),
});
export const widgetsSchema = z.array(widgetSchema).max(40);

/** Unknown styles / sizes fall back to the widget's defaults; duplicate ids are renamed. */
export function normalizeWidgets(input: z.infer<typeof widgetsSchema>): HomeWidget[] {
  const seen = new Set<string>();
  return input.map((w, i) => {
    const def: WidgetDef = WIDGETS[w.type];
    let id = w.id;
    if (seen.has(id)) id = `${id}-${i}`;
    seen.add(id);
    return {
      id,
      type: w.type,
      size: def.sizes.includes(w.size) ? w.size : def.defaultSize,
      style: def.styles.includes(w.style) ? w.style : def.styles[0],
      ...(w.config && Object.keys(w.config).length ? { config: w.config } : {}),
    };
  });
}

export function newWidget(type: WidgetType, config?: WidgetConfig): HomeWidget {
  const def: WidgetDef = WIDGETS[type];
  const id = `${type}-${Math.random().toString(36).slice(2, 9)}`;
  return { id, type, size: def.defaultSize, style: def.styles[0], ...(config ? { config } : type === "metric" ? { config: { metric: "overdue" } } : {}) };
}

const w = (type: WidgetType, size: WidgetSize, style?: string, config?: WidgetConfig): HomeWidget => ({ id: `${type}-${size}-${style ?? "d"}-${config?.metric ?? ""}`.replace(/-+$/, ""), type, size, style: style ?? WIDGETS[type].styles[0], ...(config ? { config } : {}) });

/** The five layouts the app suggests. "command" is the default Home. */
export const PRESETS = {
  command: [w("kpis", "xl"), w("focus", "xl"), w("my_day", "s"), w("attention", "s"), w("waiting", "s"), w("completed", "s"), w("my_tasks", "xl"), w("okrs", "m"), w("activity", "m"), w("projects", "xl")],
  focus: [w("focus", "xl"), w("focus_time", "m"), w("deadlines", "m"), w("my_day", "m"), w("attention", "m"), w("my_tasks", "xl", "list")],
  manager: [w("kpis", "xl", "compact"), w("waiting", "m"), w("attention", "m"), w("projects", "l", "list"), w("activity", "s", "compact"), w("okrs", "m"), w("deadlines", "m", "strip")],
  goals: [w("okrs", "l", "rings"), w("metric", "s", "ring", { metric: "completion_rate" }), w("projects", "xl", "cards"), w("my_tasks", "m", "list"), w("activity", "m")],
  minimal: [w("kpis", "xl", "big"), w("my_tasks", "xl", "list")],
} satisfies Record<string, HomeWidget[]>;
export type PresetKey = keyof typeof PRESETS;
export const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[];

/** Grid spans on a 4-column grid (2 columns on tablets, 1 on phones). */
export const SIZE_CLASS: Record<WidgetSize, string> = {
  s: "col-span-1",
  m: "col-span-1 md:col-span-2",
  l: "col-span-1 md:col-span-2 xl:col-span-3",
  xl: "col-span-1 md:col-span-2 xl:col-span-4",
};
