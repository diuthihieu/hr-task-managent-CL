"use client";
import { useEffect } from "react";
import { rememberAndroidApp } from "./pwa-client";

export function AndroidLaunch() {
  useEffect(() => {
    rememberAndroidApp(new URLSearchParams(window.location.search).get("v"));
    window.location.replace("/workspaces");
  }, []);
  return (
    <main className="flex min-h-screen items-center justify-center">
      <a href="/workspaces" className="text-sm text-neutral-500">
        woli
      </a>
    </main>
  );
}
