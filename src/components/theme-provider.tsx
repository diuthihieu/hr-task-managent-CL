"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { ThemeMode } from "@/lib/theme-colors";
import { applySizes, applyThemeMode, applyTone, setPreferenceCookie } from "@/lib/client-dom";

type Theme = "light" | "dark";
interface ThemeCtx {
  /** What is on screen right now. */
  theme: Theme;
  /** What the user picked ("system" follows the OS). */
  mode: ThemeMode;
  tone: string;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
  setTone: (t: string) => void;
  /** Text size ("sm" | "md" | "lg" | "xl") and display size ("compact" | "default" | "comfortable" | "large"). */
  fontSize: string;
  displaySize: string;
  setFontSize: (v: string) => void;
  setDisplaySize: (v: string) => void;
}
const ThemeContext = createContext<ThemeCtx>({ theme: "light", mode: "system", tone: "neutral", toggle: () => {}, setMode: () => {}, setTone: () => {}, fontSize: "md", displaySize: "default", setFontSize: () => {}, setDisplaySize: () => {} });

const systemDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * Light / dark / system + surface tone. The server renders the saved choice
 * (html class + data-tone); this keeps it live (OS changes in "system" mode)
 * and applies changes instantly. Saving to the profile is the caller's job.
 */
export function ThemeProvider({ initialMode, initialTone, initialFontSize = "md", initialDisplaySize = "default", children }: { initialMode: ThemeMode; initialTone: string; initialFontSize?: string; initialDisplaySize?: string; children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [tone, setToneState] = useState(initialTone);
  const [fontSize, setFontSizeState] = useState(initialFontSize);
  const [displaySize, setDisplaySizeState] = useState(initialDisplaySize);
  const [osDark, setOsDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only API, unreadable during SSR render
    setOsDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const theme: Theme = mode === "system" ? (osDark ? "dark" : "light") : mode;
  useEffect(() => {
    applyThemeMode(mode, theme === "dark");
  }, [mode, theme]);

  function setMode(m: ThemeMode) {
    setModeState(m);
    setPreferenceCookie("bw_theme", m);
    applyThemeMode(m, m === "system" ? systemDark() : m === "dark");
  }
  function setTone(t: string) {
    setToneState(t);
    setPreferenceCookie("bw_tone", t);
    applyTone(t);
  }
  function setFontSize(v: string) {
    setFontSizeState(v);
    setPreferenceCookie("bw_font", v);
    applySizes({ fontSize: v });
  }
  function setDisplaySize(v: string) {
    setDisplaySizeState(v);
    setPreferenceCookie("bw_display", v);
    applySizes({ displaySize: v });
  }
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setMode(next);
    fetch("/api/account/preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ themeMode: next }) }).catch(() => {});
  }

  return <ThemeContext.Provider value={{ theme, mode, tone, toggle, setMode, setTone, fontSize, displaySize, setFontSize, setDisplaySize }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
