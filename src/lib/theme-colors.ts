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
  return (ACCENT_NAMES.includes(v ?? "") ? v : "orange") as AccentName;
}

export type ThemeMode = "light" | "dark" | "system";
export const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];
export function normalizeThemeMode(v: string | null | undefined): ThemeMode {
  return THEME_MODES.includes(v as ThemeMode) ? (v as ThemeMode) : "system";
}

/** Text size - scales text only (see "Text & display size" in globals.css). */
export const FONT_SIZES = [
  { name: "sm", scale: 0.92, vi: "Nhỏ", en: "Small" },
  { name: "md", scale: 1, vi: "Vừa", en: "Default" },
  { name: "lg", scale: 1.12, vi: "Lớn", en: "Large" },
  { name: "xl", scale: 1.25, vi: "Rất lớn", en: "Extra large" },
] as const;
export type FontSize = (typeof FONT_SIZES)[number]["name"];
export const FONT_SIZE_NAMES: string[] = FONT_SIZES.map((f) => f.name);
export function normalizeFontSize(v: string | null | undefined): FontSize {
  return (FONT_SIZE_NAMES.includes(v ?? "") ? v : "md") as FontSize;
}

/** Display size - scales the whole interface (spacing, controls and text) like browser zoom. */
export const DISPLAY_SIZES = [
  { name: "compact", scale: 0.9, vi: "Gọn", en: "Compact", hintVi: "Thấy nhiều nội dung hơn - hợp màn hình nhỏ/laptop", hintEn: "More on screen - good for laptops" },
  { name: "default", scale: 1, vi: "Mặc định", en: "Default", hintVi: "Cân bằng cho hầu hết màn hình", hintEn: "Balanced for most screens" },
  { name: "comfortable", scale: 1.08, vi: "Thoáng", en: "Comfortable", hintVi: "Rộng rãi, dễ bấm hơn", hintEn: "Roomier, easier to click" },
  { name: "large", scale: 1.2, vi: "Lớn", en: "Large", hintVi: "Cho màn hình lớn/độ phân giải cao hoặc khi cần nhìn rõ hơn", hintEn: "For big / high-resolution screens or easier reading" },
] as const;
export type DisplaySize = (typeof DISPLAY_SIZES)[number]["name"];
export const DISPLAY_SIZE_NAMES: string[] = DISPLAY_SIZES.map((d) => d.name);
export function normalizeDisplaySize(v: string | null | undefined): DisplaySize {
  return (DISPLAY_SIZE_NAMES.includes(v ?? "") ? v : "default") as DisplaySize;
}

/** Surface tones (tinted grays). Keep in sync with src/app/tone-palettes.css. */
export const SURFACE_TONES = [
  { name: "neutral", group: "neutral", swatch: ["#fafafa", "#e5e5e5", "#525252"], vi: "Trung tính", en: "Neutral" },
  { name: "slate", group: "cool", swatch: ["#f8fafc", "#e2e8f0", "#475569"], vi: "Xám xanh", en: "Slate" },
  { name: "ocean", group: "cool", swatch: ["#f5f9fd", "#dce7f3", "#3f5a78"], vi: "Đại dương", en: "Ocean" },
  { name: "mint", group: "cool", swatch: ["#f6fbf9", "#dcece5", "#3f6356"], vi: "Bạc hà", en: "Mint" },
  { name: "sand", group: "warm", swatch: ["#fbf9f6", "#ece5dc", "#655646"], vi: "Cát", en: "Sand" },
  { name: "rose", group: "warm", swatch: ["#fcf8f8", "#f0e2e2", "#6b4a4c"], vi: "Hồng đất", en: "Rose" },
  { name: "amber", group: "warm", swatch: ["#fcfaf3", "#efe6cc", "#6b5a2c"], vi: "Hổ phách", en: "Amber" },
] as const;
export type SurfaceTone = (typeof SURFACE_TONES)[number]["name"];
export const SURFACE_TONE_NAMES: string[] = SURFACE_TONES.map((t) => t.name);
export function normalizeTone(v: string | null | undefined): SurfaceTone {
  return (SURFACE_TONE_NAMES.includes(v ?? "") ? v : "neutral") as SurfaceTone;
}
