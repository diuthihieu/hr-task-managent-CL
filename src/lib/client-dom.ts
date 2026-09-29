// Small browser-only helpers used by client components (kept out of the
// components so the React compiler lint doesn't treat them as render-time
// mutations).

export function setPreferenceCookie(name: "bw_locale" | "bw_accent" | "bw_theme" | "bw_tone" | "bw_font" | "bw_display", value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

export function applyAccent(name: string) {
  document.documentElement.dataset.accent = name;
}

export function currentAccent(): string {
  return (typeof document !== "undefined" ? document.documentElement.dataset.accent : undefined) ?? "indigo";
}

export function applyThemeMode(mode: string, dark: boolean) {
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.classList.toggle("dark", dark);
}

/** Text size and display size live on <html> (see "Text & display size" in globals.css). */
export function applySizes(sizes: { fontSize?: string; displaySize?: string }) {
  if (sizes.fontSize) document.documentElement.dataset.fontSize = sizes.fontSize;
  if (sizes.displaySize) document.documentElement.dataset.display = sizes.displaySize;
}

export function applyTone(tone: string) {
  document.documentElement.dataset.tone = tone;
}
