// Tiny i18n layer: one message table with the English and Vietnamese text
// side by side (so a key can never exist in one language only), a
// translate function shared by server and client, and `{name}` interpolation.

import { MESSAGES } from "./messages";

export type Locale = "vi" | "en";
export const LOCALES: Locale[] = ["vi", "en"];
export type MessageKey = keyof typeof MESSAGES;
export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function normalizeLocale(v: string | null | undefined): Locale {
  return v === "en" ? "en" : "vi";
}

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const entry = MESSAGES[key] as readonly [string, string] | undefined;
  let text = entry ? entry[locale === "en" ? 0 : 1] : String(key);
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

export function makeT(locale: Locale): TFunction {
  return (key, vars) => translate(locale, key, vars);
}
