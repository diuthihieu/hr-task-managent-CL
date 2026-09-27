// Small browser-only helpers used by client components (kept out of the
// components so the React compiler lint doesn't treat them as render-time
// mutations).

export function setPreferenceCookie(name: "bw_locale" | "bw_accent", value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

export function applyAccent(name: string) {
  document.documentElement.dataset.accent = name;
}

export function currentAccent(): string {
  return (typeof document !== "undefined" ? document.documentElement.dataset.accent : undefined) ?? "indigo";
}
