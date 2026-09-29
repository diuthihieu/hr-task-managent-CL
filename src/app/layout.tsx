import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { headers } from "next/headers";
import { getRequestPrefs } from "@/lib/prefs";
import { letterFontVars } from "./fonts";

/** Versioned so chat apps that cache previews pick up a new card when it changes. */
const OG_IMAGE = "/og/woli-og.png?v=1";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.AUTH_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")),
  title: { default: "woli | Team Workspace", template: "%s · woli" },
  description: "Projects, tasks, OKRs, a team wiki and an AI assistant in one workspace - on the web and on Windows.",
  applicationName: "woli",
  // Link previews (Teams, Zalo, Messenger, Slack, LinkedIn...): one 1200x630 card for every page.
  openGraph: {
    type: "website",
    siteName: "woli",
    title: "woli | Team Workspace",
    description: "Projects, tasks, OKRs, a team wiki and an AI assistant in one workspace - on the web and on Windows.",
    locale: "vi_VN",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "woli - Không gian làm việc thông minh cho đội ngũ" }],
  },
  twitter: { card: "summary_large_image", title: "woli | Team Workspace", description: "Projects, tasks, OKRs, a team wiki and an AI assistant in one workspace.", images: [OG_IMAGE] },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const prefs = await getRequestPrefs();
  const marketing = (await headers()).get("x-woli-marketing") === "1";
  const { locale, themeMode } = prefs;
  const accent = marketing ? "orange" : prefs.accent;
  const tone = marketing ? "neutral" : prefs.tone;
  // The landing / legal pages keep their designed size; the app follows the user's choice.
  const fontSize = marketing ? "md" : prefs.fontSize;
  const displaySize = marketing ? "default" : prefs.displaySize;
  return (
    <html lang={locale} data-accent={accent} data-tone={tone} data-theme-mode={themeMode} data-font-size={fontSize} data-display={displaySize} className={`h-full antialiased ${letterFontVars}${themeMode === "dark" ? " dark" : ""}`} suppressHydrationWarning>
      <head>
        {/* "System" mode: pick light/dark before first paint so there is no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;if(d.dataset.themeMode==="system"&&matchMedia("(prefers-color-scheme: dark)").matches)d.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers locale={locale} accent={accent} themeMode={themeMode} tone={tone} fontSize={fontSize} displaySize={displaySize}>{children}</Providers>
      </body>
    </html>
  );
}
