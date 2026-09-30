"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Moon, Sun, Monitor, RotateCcw } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { useTheme } from "@/components/theme-provider";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { ACCENT_COLORS, SURFACE_TONES, FONT_SIZES, DISPLAY_SIZES, type ThemeMode } from "@/lib/theme-colors";
import { cn } from "@/lib/utils";
import { applyAccent } from "@/lib/client-dom";
import type { Locale } from "@/lib/i18n/core";

/** Personal appearance settings: accent color (24 palettes), light/dark, language. Saved to the user's profile. */
export function PreferencesPanel() {
  const { t, locale, accent: savedAccent } = useT();
  const { mode, tone, setMode, setTone, fontSize, displaySize, setFontSize, setDisplaySize } = useTheme();
  const router = useRouter();
  const [accent, setAccent] = useState<string>(savedAccent);

  async function save(patch: { accentColor?: string; locale?: Locale; themeMode?: ThemeMode; surfaceTone?: string; fontSize?: string; displaySize?: string }) {
    try {
      await api.patch("/api/account/preferences", patch);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  function pickAccent(name: string) {
    setAccent(name);
    applyAccent(name); // instant preview; the server renders it from the profile next time
    save({ accentColor: name });
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("prefs.accent")}</h3>
        <p className="text-xs text-neutral-500 mb-3">{t("prefs.accentHint")}</p>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2" role="radiogroup" aria-label={t("prefs.accent")}>
          {ACCENT_COLORS.map((c) => (
            <button
              key={c.name}
              role="radio"
              aria-checked={accent === c.name}
              onClick={() => pickAccent(c.name)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-2 text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800",
                accent === c.name ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-200 dark:border-neutral-800"
              )}
              data-testid={`accent-${c.name}`}
            >
              <span className="h-7 w-7 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: c.swatch }}>
                {accent === c.name && <Check size={14} />}
              </span>
              <span className="truncate w-full text-center">{locale === "vi" ? c.vi : c.en}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-2">{t("prefs.mode")}</h3>
        <div className="inline-flex flex-wrap rounded-lg border border-neutral-200 dark:border-neutral-800 p-1 gap-1" role="radiogroup">
          {(
            [
              ["light", Sun, t("nav.lightMode")],
              ["dark", Moon, t("nav.darkMode")],
              ["system", Monitor, t("prefs.systemMode")],
            ] as const
          ).map(([m, Icon, label]) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                if (mode === m) return;
                setMode(m);
                save({ themeMode: m });
              }}
              className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", mode === m ? "bg-indigo-600 text-white" : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800")}
              data-testid={`mode-${m}`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {mode === "system" && <p className="text-[11px] text-neutral-400 mt-1.5">{t("prefs.systemHint")}</p>}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("prefs.tone")}</h3>
        <p className="text-xs text-neutral-500 mb-3">{t("prefs.toneHint")}</p>
        {(["neutral", "cool", "warm"] as const).map((group) => (
          <div key={group} className="mb-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400 mb-1.5">{t(`prefs.toneGroup.${group}`)}</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup">
              {SURFACE_TONES.filter((x) => x.group === group).map((x) => (
                <button
                  key={x.name}
                  role="radio"
                  aria-checked={tone === x.name}
                  onClick={() => {
                    setTone(x.name);
                    save({ surfaceTone: x.name });
                  }}
                  className={cn("rounded-lg border p-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800", tone === x.name ? "border-neutral-900 dark:border-neutral-100" : "border-neutral-200 dark:border-neutral-800")}
                  data-testid={`tone-${x.name}`}
                >
                  <span className="flex h-7 overflow-hidden rounded-md border border-black/5">
                    {x.swatch.map((c) => (
                      <span key={c} className="flex-1" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                  <span className="mt-1 flex items-center gap-1 text-[11px] text-neutral-600 dark:text-neutral-300">
                    {tone === x.name && <Check size={11} />} {locale === "vi" ? x.vi : x.en}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section data-testid="prefs-sizes">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("prefs.textSize")}</h3>
          {(fontSize !== "md" || displaySize !== "default") && (
            <button
              onClick={() => {
                setFontSize("md");
                setDisplaySize("default");
                save({ fontSize: "md", displaySize: "default" });
              }}
              className="ml-auto inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
              data-testid="sizes-reset"
            >
              <RotateCcw size={11} /> {t("prefs.sizeReset")}
            </button>
          )}
        </div>
        <p className="text-xs text-neutral-500 mb-2">{t("prefs.textSizeHint")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label={t("prefs.textSize")}>
          {FONT_SIZES.map((f) => (
            <button
              key={f.name}
              role="radio"
              aria-checked={fontSize === f.name}
              onClick={() => {
                if (fontSize === f.name) return;
                setFontSize(f.name);
                save({ fontSize: f.name });
              }}
              className={cn("rounded-lg border px-3 py-2 text-left", fontSize === f.name ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40" : "border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800")}
              data-testid={`font-${f.name}`}
            >
              {/* Fixed-size sample so each option previews its own size, not the current one. */}
              <span className="block font-semibold text-neutral-800 dark:text-neutral-100 leading-none" style={{ fontSize: `${16 * f.scale}px` }}>Aa</span>
              <span className="mt-1 flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-300">
                {fontSize === f.name && <Check size={11} className="text-indigo-600" />} {locale === "vi" ? f.vi : f.en}
              </span>
            </button>
          ))}
        </div>

        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mt-5">{t("prefs.displaySize")}</h3>
        <p className="text-xs text-neutral-500 mb-2">{t("prefs.displaySizeHint")}</p>
        <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label={t("prefs.displaySize")}>
          {DISPLAY_SIZES.map((d) => (
            <button
              key={d.name}
              role="radio"
              aria-checked={displaySize === d.name}
              onClick={() => {
                if (displaySize === d.name) return;
                setDisplaySize(d.name);
                save({ displaySize: d.name });
              }}
              className={cn("rounded-lg border px-3 py-2 text-left flex items-center gap-3", displaySize === d.name ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40" : "border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800")}
              data-testid={`display-${d.name}`}
            >
              <span className="shrink-0 rounded-md border border-neutral-300 dark:border-neutral-600 flex items-center justify-center tabular-nums text-[10px] font-semibold text-neutral-500" style={{ width: 40, height: 28 }}>
                {Math.round(d.scale * 100)}%
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">
                  {displaySize === d.name && <Check size={12} className="text-indigo-600" />} {locale === "vi" ? d.vi : d.en}
                </span>
                <span className="block text-xs text-neutral-500">{locale === "vi" ? d.hintVi : d.hintEn}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-2">{t("common.language")}</h3>
        <div className="inline-flex rounded-lg border border-neutral-200 dark:border-neutral-800 p-1 gap-1">
          {(
            [
              ["vi", "Tiếng Việt"],
              ["en", "English"],
            ] as const
          ).map(([l, label]) => (
            <button
              key={l}
              onClick={() => l !== locale && save({ locale: l })}
              className={cn("rounded-md px-3 py-1.5 text-sm", locale === l ? "bg-indigo-600 text-white" : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800")}
              data-testid={`locale-${l}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
