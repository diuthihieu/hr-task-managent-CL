// Accent palettes a user can pick in Settings → Appearance. Each name is a
// Tailwind palette; the app's accent utilities (`indigo-*`) are re-pointed
// at the chosen palette through CSS variables (see globals.css), so every
// component follows the choice without per-component changes.

export const ACCENT_COLORS = [
  { name: "indigo", swatch: "#4f46e5", vi: "Chàm", en: "Indigo" },
  { name: "blue", swatch: "#2563eb", vi: "Xanh dương", en: "Blue" },
  { name: "sky", swatch: "#0284c7", vi: "Xanh da trời", en: "Sky" },
  { name: "cyan", swatch: "#0891b2", vi: "Xanh lơ", en: "Cyan" },
  { name: "teal", swatch: "#0d9488", vi: "Xanh két", en: "Teal" },
  { name: "emerald", swatch: "#059669", vi: "Ngọc lục bảo", en: "Emerald" },
  { name: "green", swatch: "#16a34a", vi: "Xanh lá", en: "Green" },
  { name: "lime", swatch: "#65a30d", vi: "Xanh chanh", en: "Lime" },
  { name: "yellow", swatch: "#ca8a04", vi: "Vàng", en: "Yellow" },
  { name: "amber", swatch: "#d97706", vi: "Hổ phách", en: "Amber" },
  { name: "orange", swatch: "#ea580c", vi: "Cam", en: "Orange" },
  { name: "red", swatch: "#dc2626", vi: "Đỏ", en: "Red" },
  { name: "rose", swatch: "#e11d48", vi: "Hồng đỏ", en: "Rose" },
  { name: "pink", swatch: "#db2777", vi: "Hồng", en: "Pink" },
  { name: "fuchsia", swatch: "#c026d3", vi: "Hồng tím", en: "Fuchsia" },
  { name: "purple", swatch: "#9333ea", vi: "Tím", en: "Purple" },
  { name: "violet", swatch: "#7c3aed", vi: "Tím violet", en: "Violet" },
  { name: "slate", swatch: "#475569", vi: "Xám đá", en: "Slate" },
  { name: "gray", swatch: "#4b5563", vi: "Xám", en: "Gray" },
  { name: "zinc", swatch: "#52525b", vi: "Xám kẽm", en: "Zinc" },
  { name: "stone", swatch: "#57534e", vi: "Xám nâu", en: "Stone" },
  { name: "brown", swatch: "#8b5e3c", vi: "Nâu", en: "Brown" },
  { name: "navy", swatch: "#1e3a8a", vi: "Xanh hải quân", en: "Navy" },
  { name: "maroon", swatch: "#9f1239", vi: "Đỏ rượu", en: "Maroon" },
] as const;

export type AccentName = (typeof ACCENT_COLORS)[number]["name"];
export const ACCENT_NAMES: string[] = ACCENT_COLORS.map((c) => c.name);

export function normalizeAccent(v: string | null | undefined): AccentName {
  return (ACCENT_NAMES.includes(v ?? "") ? v : "indigo") as AccentName;
}
