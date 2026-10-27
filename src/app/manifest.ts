import type { MetadataRoute } from "next";

/**
 * Web app manifest: lets phones (Android, iOS) install woli as an app - its own icon on the home screen,
 * full screen, no browser bar. The installed app always loads the live site, so every deploy reaches it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "woli - Team Workspace",
    short_name: "woli",
    description: "Projects, tasks, OKRs, wiki and an AI assistant for your team.",
    start_url: "/workspaces?source=app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#f97316",
    lang: "vi",
    categories: ["productivity", "business"],
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
