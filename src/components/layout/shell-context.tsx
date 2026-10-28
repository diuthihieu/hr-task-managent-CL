"use client";
import { createContext, useContext } from "react";

/** What the workspace shell knows about the menu, for pages that show it in another form (the phone "All" page). */
export interface ShellNav {
  workspace: { id: string; name: string; slug: string };
  projects: { id: string; name: string; icon: string | null }[];
  wikis: { id: string; name: string; icon: string | null }[];
  canCreateProject: boolean;
  isAdmin: boolean;
  newProject: () => void;
  openPreferences: () => void;
  openSearch: () => void;
}

export const ShellNavContext = createContext<ShellNav | null>(null);

export function useShellNav(): ShellNav {
  const nav = useContext(ShellNavContext);
  if (!nav) throw new Error("useShellNav must be used inside the workspace shell");
  return nav;
}
