import type { Metadata } from "next";
import { AndroidLaunch } from "@/components/pwa/android-launch";

export const metadata: Metadata = { title: "woli", robots: { index: false } };

/**
 * Start address of the Android app (mobile/android: /android-app?v=1.0.0). Public on purpose: it
 * remembers, for this app window only, that it is the Android app and which version, then continues
 * to the workspaces - through sign-in if needed - without losing that.
 */
export default function AndroidAppPage() {
  return <AndroidLaunch />;
}
