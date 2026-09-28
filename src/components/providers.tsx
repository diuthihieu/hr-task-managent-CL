"use client";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "./theme-provider";
import { I18nProvider } from "./i18n-provider";
import { Toaster } from "./ui/toast";
import type { Locale } from "@/lib/i18n/core";
import type { ThemeMode } from "@/lib/theme-colors";

export function Providers({ locale, accent, themeMode, tone, children }: { locale: Locale; accent?: string; themeMode?: ThemeMode; tone?: string; children: React.ReactNode }) {
  return (
    <SessionProvider>
      <I18nProvider locale={locale} accent={accent}>
        <ThemeProvider initialMode={themeMode ?? "system"} initialTone={tone ?? "neutral"}>
          {children}
          <Toaster />
        </ThemeProvider>
      </I18nProvider>
    </SessionProvider>
  );
}
