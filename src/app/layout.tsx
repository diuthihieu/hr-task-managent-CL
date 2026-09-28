import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { getRequestPrefs } from "@/lib/prefs";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.AUTH_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")),
  title: { default: "woli. | Team Workspace", template: "%s · woli." },
  description: "Projects, tasks, OKRs, a team wiki and an AI assistant in one workspace - on the web and on Windows.",
  applicationName: "woli.",
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
