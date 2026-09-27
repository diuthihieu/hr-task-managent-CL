import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { getRequestPrefs } from "@/lib/prefs";

export const metadata: Metadata = {
  title: "Basework | Team Workspace",
  description: "Projects, tasks, OKRs and a team wiki in one workspace - on the web and on Windows.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, accent } = await getRequestPrefs();
  return (
    <html lang={locale} data-accent={accent} className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <Providers locale={locale} accent={accent}>{children}</Providers>
      </body>
    </html>
  );
}
