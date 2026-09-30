/** Icon keys a project can use (rendered by <ProjectIcon>); null/absent = no icon. */
export const PROJECT_ICON_KEYS = [
  "folder", "briefcase", "users", "user-plus", "graduation-cap", "book-open", "wallet", "banknote",
  "receipt", "calculator", "chart-bar", "chart-pie", "target", "flag", "rocket", "lightbulb",
  "calendar", "clock", "clipboard-list", "list-checks", "file-text", "shield-check", "heart-handshake", "award",
  "building", "globe", "megaphone", "message-square", "laptop", "wrench", "package", "truck",
  "shopping-cart", "star", "heart", "leaf", "coffee", "sparkles", "trophy", "puzzle",
] as const;
export type ProjectIconKey = (typeof PROJECT_ICON_KEYS)[number];
export function isProjectIcon(v: unknown): v is ProjectIconKey {
  return typeof v === "string" && (PROJECT_ICON_KEYS as readonly string[]).includes(v);
}
