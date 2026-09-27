"use client";
import { createContext, useContext, useMemo } from "react";
import { makeT, type Locale, type TFunction } from "@/lib/i18n/core";

const I18nContext = createContext<{ locale: Locale; t: TFunction; accent: string }>({ locale: "vi", t: makeT("vi"), accent: "indigo" });

export function I18nProvider({ locale, accent = "indigo", children }: { locale: Locale; accent?: string; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale), accent }), [locale, accent]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** `const { t, locale } = useT(); t("nav.myWork")` */
export function useT() {
  return useContext(I18nContext);
}
