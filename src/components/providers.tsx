"use client";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "./theme-provider";
import { I18nProvider } from "./i18n-provider";
import { Toaster } from "./ui/toast";
import type { Locale } from "@/lib/i18n/core";

export function Providers({ locale, accent, children }: { locale: Locale; accent?: string; children: React.ReactNode }) {
  return (
    <SessionProvider>
      <I18nProvider locale={locale} accent={accent}>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </I18nProvider>
    </SessionProvider>
  );
}
